// =============================================================================
// engine.js — World Cup 2026 Simulator: simulation engine.
//
// HARD CONSTRAINTS (see build spec):
//   - Imports nothing from the UI. References no DOM. Runs under `node test.js`.
//   - Deterministic given a seed: same seed -> identical tournament.
//   - No hand-tuning of any team. Strength comes ONLY from Elo (+ host home bonus).
//
// Model (BRIEF.md §4, DATA-VERIFIED.md §3):
//   Elo diff -> per-team win expectancy -> per-team expected goals (split of a
//   fixed 2.7 total) -> independent Poisson draw per team -> score + event stream.
//   Knockout draws: extra time (lower goal window) then penalty shootout.
//
// All randomness flows through a mulberry32 generator passed explicitly as the
// final argument of every stochastic function. Nothing here calls Math.random
// inside the tournament path, so determinism is airtight.
// =============================================================================

import {
  TEAMS,
  GROUPS,
  GROUP_LETTERS,
  GROUP_MATCHES,
  KNOCKOUT_R32,
  KNOCKOUT_ROUNDS,
  HOME_ADVANTAGE,
  HOST_COUNTRIES,
  TARGET_MEAN_TOTAL_GOALS,
} from './data.js';

// ---- tuning constants (model, not per-team) --------------------------------
const MIN_EXP_GOALS = 0.15;        // floor for each team's expected goals (>0)
const ELO_SCALE = 400;             // standard Elo logistic scale
const ET_FRACTION = 30 / 90;       // extra time is 30 of 90 min...
const ET_CAGINESS = 0.85;          // ...and slightly cagier than open play
const PEN_BASE_CONVERSION = 0.75;  // baseline penalty conversion rate
const PEN_ELO_SWING = 1 / 8000;    // tiny Elo lean on penalty conversion

// ---- small utilities -------------------------------------------------------
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const TEAM_BY_CODE = Object.fromEntries(TEAMS.map((t) => [t.code, t]));
export const teamByCode = (code) => TEAM_BY_CODE[code];

/**
 * mulberry32 — fast, seedable PRNG. Returns a function yielding floats in [0,1).
 * Same seed -> same sequence (the backbone of determinism & replay).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw a single sample from Poisson(lambda) using Knuth's algorithm.
 * lambda is small here (<= ~2.7) so this is cheap and exact.
 */
export function poissonSample(lambda, rng) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

/**
 * Host home bonus: +HOME_ADVANTAGE only when the team is a host AND the venue
 * is in that host's own country. At most one side of any match can qualify
 * (a match has a single venueCountry), so the advantage is applied to at most
 * one team — neutral otherwise.
 */
function homeBonus(team, venueCountry) {
  if (team.isHost && HOST_COUNTRIES[team.code] === venueCountry) return HOME_ADVANTAGE;
  return 0;
}

/**
 * Convert an Elo matchup into per-team expected goals.
 * eloDiff (incl. host bonus) -> win expectancy We = 1/(10^(-dr/400)+1)
 * -> expected goals = TARGET_MEAN_TOTAL_GOALS * We, floored at MIN_EXP_GOALS.
 *
 * Because expA + expB = TARGET (before the rare floor on extreme mismatches),
 * the average total goals per match is ~2.7 by construction — calibration is a
 * structural property of the model, not a hand-tuned fudge.
 *
 * Returns { expA, expB, eloDiff, weA }.
 */
export function expectedGoals(teamA, teamB, venueCountry) {
  const eloA = teamA.elo + homeBonus(teamA, venueCountry);
  const eloB = teamB.elo + homeBonus(teamB, venueCountry);
  const eloDiff = eloA - eloB;
  const weA = 1 / (Math.pow(10, -eloDiff / ELO_SCALE) + 1);
  const weB = 1 - weA;
  const expA = Math.max(MIN_EXP_GOALS, TARGET_MEAN_TOTAL_GOALS * weA);
  const expB = Math.max(MIN_EXP_GOALS, TARGET_MEAN_TOTAL_GOALS * weB);
  return { expA, expB, eloDiff, weA };
}

/**
 * NO-OP HOOK — Dixon-Coles low-score (tau) correction.
 *
 * Independent Poisson slightly under-predicts 0-0/1-0/0-1/1-1 outcomes. A future
 * version can build a score-probability matrix and multiply the low-score cells
 * by the Dixon-Coles tau factor here, then renormalise. We intentionally draw
 * goals via two independent Poisson samples (below, in playMatch) rather than
 * sampling from a matrix, so this hook currently just returns its input
 * unchanged. See DATA-VERIFIED.md §4. DO NOT implement the correction now.
 */
export function applyLowScoreCorrection(scoreMatrix) {
  return scoreMatrix; // no-op by design
}

// Generate `n` goal events for one side within [minMinute, maxMinute].
function goalEvents(n, side, teamCode, minMinute, maxMinute, rng) {
  const span = maxMinute - minMinute + 1;
  const ev = [];
  for (let i = 0; i < n; i++) {
    ev.push({ side, team: teamCode, minute: minMinute + Math.floor(rng() * span) });
  }
  return ev;
}

/**
 * Simulate a penalty shootout. Near-coinflip with a slight Elo lean baked into
 * each team's per-kick conversion rate. Plays best-of-5 then sudden death, so it
 * yields a realistic shootout score (e.g. 4-3) and never returns a tie.
 * Returns { penA, penB, winnerSide }.
 */
function penaltyShootout(eloDiff, rng) {
  const convA = clamp(PEN_BASE_CONVERSION + eloDiff * PEN_ELO_SWING, 0.6, 0.9);
  const convB = clamp(PEN_BASE_CONVERSION - eloDiff * PEN_ELO_SWING, 0.6, 0.9);
  let penA = 0;
  let penB = 0;

  // Best-of-5.
  for (let round = 0; round < 5; round++) {
    if (rng() < convA) penA++;
    if (rng() < convB) penB++;
  }
  // Sudden death until a difference appears (cap iterations defensively).
  let guard = 0;
  while (penA === penB && guard < 100) {
    const a = rng() < convA ? 1 : 0;
    const b = rng() < convB ? 1 : 0;
    penA += a;
    penB += b;
    guard++;
  }
  // Defensive tiebreak (only if the guard ever trips): lean to the higher Elo.
  let winnerSide;
  if (penA === penB) winnerSide = eloDiff >= 0 ? 'a' : 'b';
  else winnerSide = penA > penB ? 'a' : 'b';
  return { penA, penB, winnerSide };
}

/**
 * playMatch(teamA, teamB, opts, rng)
 *   opts = { knockout, venueCountry }
 *   rng  = seeded generator (defaults to Math.random for convenience; the
 *          tournament path always passes a seeded rng for determinism).
 *
 * Returns a rich result object (score, event stream, ET/penalty details,
 * winnerSide). For a non-knockout draw, winnerSide is null.
 */
export function playMatch(teamA, teamB, opts = {}, rng = Math.random) {
  const { knockout = false, venueCountry = null } = opts;
  const { expA, expB, eloDiff } = expectedGoals(teamA, teamB, venueCountry);

  // Independent Poisson draw per team. (A score-probability matrix + the
  // applyLowScoreCorrection hook could replace this block in a later version.)
  let scoreA = poissonSample(expA, rng);
  let scoreB = poissonSample(expB, rng);

  const events = [
    ...goalEvents(scoreA, 'a', teamA.code, 1, 90, rng),
    ...goalEvents(scoreB, 'b', teamB.code, 1, 90, rng),
  ];

  const result = {
    a: teamA.code,
    b: teamB.code,
    teamA,
    teamB,
    scoreA,
    scoreB,
    knockout: !!knockout,
    extraTime: false,
    etScoreA: 0,
    etScoreB: 0,
    finalScoreA: scoreA,
    finalScoreB: scoreB,
    penalties: false,
    penA: null,
    penB: null,
    events,
    winnerSide: scoreA > scoreB ? 'a' : scoreA < scoreB ? 'b' : null,
  };

  if (!knockout || result.winnerSide !== null) return result;

  // ---- knockout & drawn after regulation: extra time -----------------------
  const etExpA = expA * ET_FRACTION * ET_CAGINESS;
  const etExpB = expB * ET_FRACTION * ET_CAGINESS;
  const etA = poissonSample(etExpA, rng);
  const etB = poissonSample(etExpB, rng);
  result.extraTime = true;
  result.etScoreA = etA;
  result.etScoreB = etB;
  result.finalScoreA = scoreA + etA;
  result.finalScoreB = scoreB + etB;
  result.events.push(...goalEvents(etA, 'a', teamA.code, 91, 120, rng));
  result.events.push(...goalEvents(etB, 'b', teamB.code, 91, 120, rng));

  if (result.finalScoreA !== result.finalScoreB) {
    result.winnerSide = result.finalScoreA > result.finalScoreB ? 'a' : 'b';
    result.events.sort((x, y) => x.minute - y.minute);
    return result;
  }

  // ---- still level: penalty shootout ---------------------------------------
  const { penA, penB, winnerSide } = penaltyShootout(eloDiff, rng);
  result.penalties = true;
  result.penA = penA;
  result.penB = penB;
  result.winnerSide = winnerSide;
  result.events.sort((x, y) => x.minute - y.minute);
  return result;
}

// Resolve a result's winning / losing team object (uses winnerSide).
function winnerTeam(res) {
  return res.winnerSide === 'a' ? res.teamA : res.teamB;
}
function loserTeam(res) {
  return res.winnerSide === 'a' ? res.teamB : res.teamA;
}

// ---------------------------------------------------------------------------
// Group stage
// ---------------------------------------------------------------------------

// Build an empty standings row for a team.
function emptyRow(team) {
  return {
    team,
    code: team.code,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    points: 0,
  };
}

// Apply one played match to two standings rows.
function applyResult(rowA, rowB, res) {
  rowA.played++;
  rowB.played++;
  rowA.gf += res.scoreA;
  rowA.ga += res.scoreB;
  rowB.gf += res.scoreB;
  rowB.ga += res.scoreA;
  if (res.scoreA > res.scoreB) {
    rowA.won++;
    rowB.lost++;
    rowA.points += 3;
  } else if (res.scoreA < res.scoreB) {
    rowB.won++;
    rowA.lost++;
    rowB.points += 3;
  } else {
    rowA.drawn++;
    rowB.drawn++;
    rowA.points++;
    rowB.points++;
  }
  rowA.gd = rowA.gf - rowA.ga;
  rowB.gd = rowB.gf - rowB.ga;
}

// Head-to-head mini-table tiebreak among a set of tied rows, using only the
// matches played between those teams. Falls through to a deterministic final
// tiebreak (world rank -> Elo -> code) so ranking is always total & repeatable.
function breakTieHeadToHead(tied, playedMatches) {
  const codes = new Set(tied.map((r) => r.code));
  const mini = {};
  for (const r of tied) mini[r.code] = { points: 0, gd: 0, gf: 0 };
  for (const m of playedMatches) {
    if (codes.has(m.a) && codes.has(m.b)) {
      const A = mini[m.a];
      const B = mini[m.b];
      A.gf += m.scoreA;
      B.gf += m.scoreB;
      A.gd += m.scoreA - m.scoreB;
      B.gd += m.scoreB - m.scoreA;
      if (m.scoreA > m.scoreB) A.points += 3;
      else if (m.scoreA < m.scoreB) B.points += 3;
      else {
        A.points++;
        B.points++;
      }
    }
  }
  return tied.slice().sort((x, y) => {
    const mx = mini[x.code];
    const my = mini[y.code];
    if (my.points !== mx.points) return my.points - mx.points;
    if (my.gd !== mx.gd) return my.gd - mx.gd;
    if (my.gf !== mx.gf) return my.gf - mx.gf;
    // deterministic final fallback (stands in for conduct / FIFA rank / lots)
    if (x.team.worldRank !== y.team.worldRank) return x.team.worldRank - y.team.worldRank;
    if (y.team.elo !== x.team.elo) return y.team.elo - x.team.elo;
    return x.code < y.code ? -1 : 1;
  });
}

// Sort standings: points -> GD -> goals scored -> head-to-head (within group).
// (Order per build spec; H2H is the final on-pitch tiebreak.)
function sortStandings(rows, playedMatches) {
  const primary = (x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    if (y.gd !== x.gd) return y.gd - x.gd;
    if (y.gf !== x.gf) return y.gf - x.gf;
    return 0; // tied on points/GD/GF -> resolve by head-to-head below
  };
  rows.sort(primary);
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && primary(rows[i], rows[j]) === 0) j++;
    if (j - i > 1) {
      const ordered = breakTieHeadToHead(rows.slice(i, j), playedMatches);
      for (let k = 0; k < ordered.length; k++) rows[i + k] = ordered[k];
    }
    i = j;
  }
  return rows;
}

/**
 * playGroup(group, rng) — group is a letter 'A'..'L'.
 * Plays the 6 round-robin matches, builds the sorted standings table.
 * Returns { group, matches, standings, winner, runnerUp, third, fourth }.
 */
export function playGroup(group, rng = Math.random) {
  const rows = {};
  for (const code of GROUPS[group]) rows[code] = emptyRow(TEAM_BY_CODE[code]);

  const fixtures = GROUP_MATCHES.filter((m) => m.group === group);
  const played = [];
  for (const f of fixtures) {
    const res = playMatch(TEAM_BY_CODE[f.a], TEAM_BY_CODE[f.b], { venueCountry: f.venueCountry }, rng);
    applyResult(rows[f.a], rows[f.b], res);
    played.push({ a: f.a, b: f.b, scoreA: res.scoreA, scoreB: res.scoreB, fixture: f, result: res });
  }

  const standings = sortStandings(Object.values(rows), played);
  return {
    group,
    matches: played,
    standings,
    winner: standings[0].team,
    runnerUp: standings[1].team,
    third: standings[2].team,
    fourth: standings[3].team,
  };
}

// ---------------------------------------------------------------------------
// Third-place ranking & assignment
// ---------------------------------------------------------------------------

/**
 * rankThirdPlaces(groupResults) — rank all 12 third-placed teams.
 * Order: points -> GD -> goals scored -> conduct -> world rank. NO head-to-head
 * (they come from different groups). Conduct is not modelled (constant), so it
 * is a no-op step that falls through to world rank. Returns the top 8 as
 * [{ team, group, points, gd, gf, worldRank }, ...].
 */
export function rankThirdPlaces(groupResults) {
  const thirds = groupResults.map((g) => {
    const row = g.standings[2];
    return {
      team: row.team,
      group: g.group,
      points: row.points,
      gd: row.gd,
      gf: row.gf,
      worldRank: row.team.worldRank,
    };
  });
  thirds.sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    if (y.gd !== x.gd) return y.gd - x.gd;
    if (y.gf !== x.gf) return y.gf - x.gf;
    // conduct score: not modelled (treated equal) -> fall through
    if (x.worldRank !== y.worldRank) return x.worldRank - y.worldRank;
    return x.group < y.group ? -1 : 1; // deterministic final fallback
  });
  return thirds.slice(0, 8);
}

// The 8 group winners that receive a third-placer (BRIEF.md §5.4), fixed order.
const THIRD_RECEIVING_WINNERS = ['A', 'B', 'D', 'E', 'G', 'I', 'K', 'L'];

/**
 * assignThirdPlaces(top8) — deterministic rank-and-assign fallback that REPLACES
 * FIFA's 495-row lookup table (DATA-VERIFIED.md §4).
 *
 * Assignment rule:
 *   - Slots are the 8 group winners A,B,D,E,G,I,K,L (fixed order).
 *   - A third may take any slot EXCEPT its own group's winner (the
 *     "no same-group rematch" constraint, acceptance criterion 3).
 *   - We compute a complete bijection via Kuhn's augmenting-path matching,
 *     processing thirds in rank order (best first) and slots in fixed order.
 *     A perfect matching always exists (each third forbids at most one slot, so
 *     Hall's condition holds), and the fixed processing order makes the result
 *     deterministic. A naive greedy pass could dead-end; augmenting paths cannot.
 *
 * Returns a map { A: thirdEntry, B: thirdEntry, ... } keyed by the winner group
 * that the third faces. To swap in the official 495-row table later, replace the
 * body of this function only — callers (playKnockout) are unaffected.
 */
export function assignThirdPlaces(top8) {
  const slots = THIRD_RECEIVING_WINNERS;
  const slotToThird = new Array(slots.length).fill(-1); // slot index -> third index

  const tryAssign = (thirdIdx, seen) => {
    for (let s = 0; s < slots.length; s++) {
      if (top8[thirdIdx].group === slots[s]) continue; // no same-group rematch
      if (seen[s]) continue;
      seen[s] = true;
      if (slotToThird[s] === -1 || tryAssign(slotToThird[s], seen)) {
        slotToThird[s] = thirdIdx;
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < top8.length; i++) {
    const ok = tryAssign(i, new Array(slots.length).fill(false));
    if (!ok) throw new Error('assignThirdPlaces: no valid no-rematch assignment (should be impossible)');
  }

  const assignment = {};
  for (let s = 0; s < slots.length; s++) assignment[slots[s]] = top8[slotToThird[s]];
  return assignment;
}

// ---------------------------------------------------------------------------
// Knockout stage
// ---------------------------------------------------------------------------

// Resolve an R32 slot descriptor to a team object.
// matchWinnerGroup is the group of the 'W' slot in the same match (used to
// look up which third faces this winner).
function resolveR32Slot(slot, matchWinnerGroup, qualified) {
  if (slot.slot === 'W') return qualified.winners[slot.group];
  if (slot.slot === 'R') return qualified.runnersUp[slot.group];
  if (slot.slot === 'T') return qualified.thirdAssignment[matchWinnerGroup].team;
  throw new Error(`unknown R32 slot type: ${slot.slot}`);
}

/**
 * playKnockout(qualified, rng)
 *   qualified = { winners:{A..L}, runnersUp:{A..L}, thirdAssignment:{A,B,D,E,G,I,K,L} }
 *
 * Resolves R32 from data, then R16 -> QF -> SF -> 3rd-place -> FINAL by feeding
 * winners/losers forward. Every knockout match is decisive (ET + penalties).
 * Returns { rounds:{R32,R16,QF,SF,THIRD,FINAL}, byId, champion, runnerUp, third, fourth }.
 */
export function playKnockout(qualified, rng = Math.random) {
  const out = { rounds: {}, byId: {} };

  // ---- Round of 32 ----
  const r32 = [];
  for (const m of KNOCKOUT_R32) {
    const winnerGroup = m.a.slot === 'W' ? m.a.group : m.b.slot === 'W' ? m.b.group : null;
    const teamA = resolveR32Slot(m.a, winnerGroup, qualified);
    const teamB = resolveR32Slot(m.b, winnerGroup, qualified);
    const result = playMatch(teamA, teamB, { knockout: true, venueCountry: m.venueCountry }, rng);
    const rec = { id: m.id, meta: m, teamA, teamB, result, winner: winnerTeam(result), loser: loserTeam(result) };
    out.byId[m.id] = rec;
    r32.push(rec);
  }
  out.rounds.R32 = r32;

  // ---- subsequent rounds, fed from prior results ----
  const pick = (ref) => {
    const src = out.byId[ref.from];
    return ref.take === 'winner' ? src.winner : src.loser;
  };
  for (const rnd of KNOCKOUT_ROUNDS) {
    const recs = [];
    for (const m of rnd.matches) {
      const teamA = pick(m.a);
      const teamB = pick(m.b);
      const result = playMatch(teamA, teamB, { knockout: true, venueCountry: m.venueCountry }, rng);
      const rec = { id: m.id, meta: m, teamA, teamB, result, winner: winnerTeam(result), loser: loserTeam(result) };
      out.byId[m.id] = rec;
      recs.push(rec);
    }
    out.rounds[rnd.round] = recs;
  }

  out.champion = out.byId.FINAL.winner;
  out.runnerUp = out.byId.FINAL.loser;
  out.third = out.byId.THIRD.winner;
  out.fourth = out.byId.THIRD.loser;
  return out;
}

// ---------------------------------------------------------------------------
// Whole-tournament drivers
// ---------------------------------------------------------------------------

/**
 * simulateTournament(seed) — one full deterministic run.
 * Same seed -> identical tournament (enables replay).
 */
export function simulateTournament(seed) {
  const rng = mulberry32(seed);

  const groups = GROUP_LETTERS.map((L) => playGroup(L, rng));

  const winners = {};
  const runnersUp = {};
  for (const g of groups) {
    winners[g.group] = g.standings[0].team;
    runnersUp[g.group] = g.standings[1].team;
  }

  const thirdsRanked = rankThirdPlaces(groups);
  const thirdAssignment = assignThirdPlaces(thirdsRanked);

  const knockout = playKnockout({ winners, runnersUp, thirdAssignment }, rng);

  return {
    seed,
    groups,
    winners,
    runnersUp,
    thirdsRanked,
    thirdAssignment,
    knockout,
    champion: knockout.champion,
  };
}

// Stage keys tracked by the aggregator, in monotone (broadest -> narrowest) order.
export const STAGE_KEYS = ['reachR32', 'reachR16', 'reachQF', 'reachSF', 'reachFinal', 'champion'];

/**
 * monteCarlo(n, baseSeed) — run n full tournaments and aggregate per-team
 * stage-reach probabilities. Reproducible: run i uses seed (baseSeed + i).
 *
 * Returns { code: { winGroup, reachR32, reachR16, reachQF, reachSF, reachFinal,
 * champion } } where each value is a probability in [0,1].
 */
export function monteCarlo(n, baseSeed = 1) {
  const tally = {};
  for (const t of TEAMS) {
    tally[t.code] = {
      winGroup: 0,
      reachR32: 0,
      reachR16: 0,
      reachQF: 0,
      reachSF: 0,
      reachFinal: 0,
      champion: 0,
    };
  }

  for (let i = 0; i < n; i++) {
    const sim = simulateTournament(baseSeed + i);

    for (const g of sim.groups) {
      tally[g.standings[0].team.code].winGroup++;
      tally[g.standings[0].team.code].reachR32++;
      tally[g.standings[1].team.code].reachR32++;
    }
    for (const grp of THIRD_RECEIVING_WINNERS) {
      tally[sim.thirdAssignment[grp].team.code].reachR32++;
    }
    for (const rec of sim.knockout.rounds.R32) tally[rec.winner.code].reachR16++;
    for (const rec of sim.knockout.rounds.R16) tally[rec.winner.code].reachQF++;
    for (const rec of sim.knockout.rounds.QF) tally[rec.winner.code].reachSF++;
    for (const rec of sim.knockout.rounds.SF) tally[rec.winner.code].reachFinal++;
    tally[sim.knockout.champion.code].champion++;
  }

  const result = {};
  for (const code in tally) {
    const c = tally[code];
    result[code] = {
      winGroup: c.winGroup / n,
      reachR32: c.reachR32 / n,
      reachR16: c.reachR16 / n,
      reachQF: c.reachQF / n,
      reachSF: c.reachSF / n,
      reachFinal: c.reachFinal / n,
      champion: c.champion / n,
    };
  }
  return result;
}
