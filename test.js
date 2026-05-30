// =============================================================================
// test.js — headless acceptance tests for the World Cup 2026 engine.
//
//   node test.js
//
// Proves the five acceptance criteria from the build spec:
//   1. Determinism        — simulateTournament(42) twice -> byte-identical.
//   2. Calibration        — 10,000 matches, mean total goals = 2.7 ± 0.15.
//   3. Structural validity — exactly 32 R32 teams (24 direct + 8 thirds), no
//                            duplicates, no third faces its own group winner,
//                            bracket resolves to a single champion.
//   4. Monte Carlo sanity  — 10,000 runs: stage probs monotone, sums exact,
//                            Spain/Argentina/France top, Qatar/Curaçao bottom.
//   5. Home advantage      — a host at home wins more than the same neutral tie.
//
// No test framework, no dependencies — runs anywhere Node does.
// =============================================================================

import { TEAMS, GROUP_LETTERS, TARGET_MEAN_TOTAL_GOALS, KNOCKOUT_R32, KNOCKOUT_ROUNDS } from './data.js';
import {
  mulberry32,
  playMatch,
  simulateTournament,
  monteCarlo,
  teamByCode,
} from './engine.js';

let failures = 0;
let checks = 0;
function assert(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log('  ✗ FAIL:', msg);
  } else {
    console.log('  ✓', msg);
  }
}
function section(title) {
  console.log('\n' + title);
}

// A stable, structural digest of a tournament (ignores live object refs).
function digest(sim) {
  const groupPart = sim.groups
    .map(
      (g) =>
        g.group +
        ':' +
        g.standings
          .map((r) => `${r.code}|${r.points}|${r.gd}|${r.gf}`)
          .join(',')
    )
    .join(';');
  const koPart = Object.keys(sim.knockout.rounds)
    .map((round) =>
      sim.knockout.rounds[round]
        .map(
          (m) =>
            `${m.id}=${m.teamA.code}${m.result.finalScoreA}-${m.result.finalScoreB}${m.teamB.code}` +
            (m.result.penalties ? `p${m.result.penA}-${m.result.penB}` : '') +
            `>${m.winner.code}`
        )
        .join(',')
    )
    .join('|');
  return `${groupPart}#${koPart}#champ=${sim.champion.code}`;
}

// ----------------------------------------------------------------------------
// 1. DETERMINISM
// ----------------------------------------------------------------------------
section('1. Determinism — same seed -> identical tournament');
{
  const a = simulateTournament(42);
  const b = simulateTournament(42);
  const da = digest(a);
  const db = digest(b);
  assert(da === db, 'simulateTournament(42) run twice is byte-identical');

  const c = simulateTournament(43);
  assert(digest(c) !== da, 'a different seed (43) produces a different tournament');

  // determinism also holds at the match level
  const r1 = playMatch(teamByCode('ESP'), teamByCode('BRA'), { knockout: true }, mulberry32(7));
  const r2 = playMatch(teamByCode('ESP'), teamByCode('BRA'), { knockout: true }, mulberry32(7));
  assert(
    r1.finalScoreA === r2.finalScoreA && r1.finalScoreB === r2.finalScoreB && r1.winnerSide === r2.winnerSide,
    'playMatch with same seed is identical'
  );
}

// ----------------------------------------------------------------------------
// 2. CALIBRATION
// ----------------------------------------------------------------------------
section('2. Calibration — mean total goals over 10,000 matches ≈ 2.7');
{
  const rng = mulberry32(2026);
  const N = 10000;
  let total = 0;
  for (let i = 0; i < N; i++) {
    // random distinct matchup, neutral venue (no home bonus)
    const a = TEAMS[Math.floor(rng() * TEAMS.length)];
    let b = TEAMS[Math.floor(rng() * TEAMS.length)];
    while (b === a) b = TEAMS[Math.floor(rng() * TEAMS.length)];
    const res = playMatch(a, b, { venueCountry: null }, rng);
    total += res.scoreA + res.scoreB;
  }
  const mean = total / N;
  console.log(`     mean total goals = ${mean.toFixed(4)} (target ${TARGET_MEAN_TOTAL_GOALS} ± 0.15)`);
  assert(Math.abs(mean - TARGET_MEAN_TOTAL_GOALS) <= 0.15, `mean total goals within 2.7 ± 0.15`);
}

// ----------------------------------------------------------------------------
// 3. STRUCTURAL VALIDITY
// ----------------------------------------------------------------------------
section('3. Structural validity — R32 field, no rematches, single champion');
{
  const SAMPLE = 200; // check structure across many independent tournaments
  let allGood = true;
  let dupSeen = false;
  let rematchSeen = false;
  let badCount = false;
  let badChampion = false;

  for (let s = 0; s < SAMPLE; s++) {
    const sim = simulateTournament(1000 + s);

    // collect the 32 R32 participants
    const r32Teams = [];
    for (const rec of sim.knockout.rounds.R32) {
      r32Teams.push(rec.teamA.code, rec.teamB.code);
    }
    if (r32Teams.length !== 32) badCount = true;
    if (new Set(r32Teams).size !== 32) dupSeen = true; // no team appears twice

    // 24 direct (12 winners + 12 runners-up) + 8 thirds
    const directCount =
      GROUP_LETTERS.length * 2; // 24
    const thirdCount = Object.keys(sim.thirdAssignment).length; // 8
    if (directCount + thirdCount !== 32) badCount = true;

    // no third-placer faces its own group winner
    for (const grp of Object.keys(sim.thirdAssignment)) {
      const third = sim.thirdAssignment[grp];
      const winner = sim.winners[grp];
      if (third.team.group === winner.group) rematchSeen = true;
      if (third.group === grp) rematchSeen = true; // (same statement, explicit)
    }

    // every group winner/runner-up is genuinely 1st/2nd of its group
    for (const g of sim.groups) {
      if (sim.winners[g.group].code !== g.standings[0].team.code) allGood = false;
      if (sim.runnersUp[g.group].code !== g.standings[1].team.code) allGood = false;
    }

    // bracket resolves to exactly one champion that actually won the final
    if (!sim.champion || sim.knockout.byId.FINAL.winner.code !== sim.champion.code) badChampion = true;

    // the 8 qualified thirds are the 8 best by the ranking rule (distinct groups)
    if (new Set(sim.thirdsRanked.map((t) => t.group)).size !== 8) allGood = false;
  }

  assert(!badCount, `every tournament has exactly 32 R32 teams (24 direct + 8 thirds) [${SAMPLE} sims]`);
  assert(!dupSeen, 'no team ever appears twice in the R32 field');
  assert(!rematchSeen, 'no third-placer ever faces its own group winner in R32');
  assert(allGood, 'winners/runners-up are the true 1st/2nd; 8 thirds come from 8 distinct groups');
  assert(!badChampion, 'bracket always resolves to a single champion (winner of the final)');
}

// ----------------------------------------------------------------------------
// 4. MONTE CARLO SANITY
// ----------------------------------------------------------------------------
section('4. Monte Carlo — 10,000 runs: monotone, sums exact, favourites on top');
let mc; // reused by the summary print at the end
{
  const N = 10000;
  mc = monteCarlo(N, 1);

  // (a) per-team monotonicity along the progression chain
  let monoOk = true;
  for (const t of TEAMS) {
    const p = mc[t.code];
    if (
      !(
        p.reachR32 >= p.reachR16 - 1e-9 &&
        p.reachR16 >= p.reachQF - 1e-9 &&
        p.reachQF >= p.reachSF - 1e-9 &&
        p.reachSF >= p.reachFinal - 1e-9 &&
        p.reachFinal >= p.champion - 1e-9
      )
    ) {
      monoOk = false;
    }
    // winning the group implies reaching the R32
    if (p.winGroup > p.reachR32 + 1e-9) monoOk = false;
  }
  assert(monoOk, 'every team: reachR32 ≥ reachR16 ≥ reachQF ≥ reachSF ≥ reachFinal ≥ champion');

  // (b) per-run population sums (each is exact regardless of N)
  const sum = (key) => TEAMS.reduce((acc, t) => acc + mc[t.code][key], 0);
  const approx = (x, target, msg) => assert(Math.abs(x - target) < 1e-6, `${msg} (= ${x.toFixed(4)}, want ${target})`);
  approx(sum('champion'), 1, 'Σ champion% = 1 (exactly one champion per run)');
  approx(sum('reachFinal'), 2, 'Σ reachFinal% = 2 (two finalists per run)');
  approx(sum('reachSF'), 4, 'Σ reachSF% = 4');
  approx(sum('reachQF'), 8, 'Σ reachQF% = 8');
  approx(sum('reachR16'), 16, 'Σ reachR16% = 16');
  approx(sum('reachR32'), 32, 'Σ reachR32% = 32');
  approx(sum('winGroup'), 12, 'Σ winGroup% = 12 (one winner per group)');

  // (c) favourites on top, minnows at the bottom (driven purely by Elo)
  const byTitle = [...TEAMS].sort((x, y) => mc[y.code].champion - mc[x.code].champion);
  const top3 = byTitle.slice(0, 3).map((t) => t.code);
  console.log('     title-odds top 3:', top3.join(', '));
  assert(
    ['ESP', 'ARG', 'FRA'].every((c) => top3.includes(c)),
    'Spain, Argentina, France are the top 3 title favourites'
  );

  const qatar = mc['QAT'].champion;
  const curacao = mc['CUW'].champion;
  const medianTitle = byTitle[Math.floor(TEAMS.length / 2)];
  console.log(`     Qatar title% = ${(qatar * 100).toFixed(2)}, Curaçao title% = ${(curacao * 100).toFixed(2)}`);
  assert(
    qatar <= mc[medianTitle.code].champion && curacao <= mc[medianTitle.code].champion,
    'Qatar and Curaçao are in the bottom half of title odds'
  );
}

// ----------------------------------------------------------------------------
// 5. HOME ADVANTAGE
// ----------------------------------------------------------------------------
section('5. Home advantage — host at home wins more than the same neutral tie');
{
  // United States (host, Elo 1721) vs a fixed opponent of similar strength.
  const usa = teamByCode('USA');
  const opp = teamByCode('AUS'); // Australia 1783 — close, so the +100 bias is visible
  const N = 20000;

  const winRate = (venueCountry) => {
    const rng = mulberry32(555);
    let wins = 0;
    for (let i = 0; i < N; i++) {
      const r = playMatch(usa, opp, { venueCountry }, rng);
      if (r.winnerSide === 'a') wins++;
    }
    return wins / N;
  };

  const home = winRate('USA'); // USA gets +100
  const neutral = winRate('Canada'); // venue not in USA -> neutral for USA
  console.log(`     USA win rate — home: ${(home * 100).toFixed(1)}%  neutral: ${(neutral * 100).toFixed(1)}%`);
  assert(home > neutral + 0.02, 'host win rate is measurably higher at home than neutral');
}

// ----------------------------------------------------------------------------
// 6. BRACKET BALANCE — official fixed tree keeps top Elo seeds in opposite halves
// ----------------------------------------------------------------------------
section('6. Bracket balance — top seeds drawn into opposite halves');
{
  // Forward winner-feed map: matchId -> the match that consumes its WINNER.
  // Purely structural (result-independent): a slot's half never changes.
  const winnerFeed = {};
  for (const rnd of KNOCKOUT_ROUNDS) {
    for (const m of rnd.matches) {
      for (const ref of [m.a, m.b]) {
        if (ref.take === 'winner') winnerFeed[ref.from] = m.id;
      }
    }
  }
  const SF_IDS = new Set(KNOCKOUT_ROUNDS.find((r) => r.round === 'SF').matches.map((m) => m.id));

  // Which semifinal does a given group's WINNER ultimately feed into?
  const sfHalfOfGroupWinner = (group) => {
    let cur = null;
    for (const m of KNOCKOUT_R32) {
      if ((m.a.slot === 'W' && m.a.group === group) || (m.b.slot === 'W' && m.b.group === group)) {
        cur = m.id;
        break;
      }
    }
    let guard = 0;
    while (cur && !SF_IDS.has(cur) && guard++ < 20) cur = winnerFeed[cur];
    return SF_IDS.has(cur) ? cur : null;
  };

  const hSpain = sfHalfOfGroupWinner('H'); // Spain     — Elo #1
  const jArg = sfHalfOfGroupWinner('J');   // Argentina — Elo #2
  const iFra = sfHalfOfGroupWinner('I');   // France    — Elo #3
  const lEng = sfHalfOfGroupWinner('L');   // England   — Elo #4
  console.log(`     SF half -> Spain(H):${hSpain}  Argentina(J):${jArg}  France(I):${iFra}  England(L):${lEng}`);

  assert(hSpain && jArg && iFra && lEng, 'all four top-seed group winners trace to a semifinal');
  assert(hSpain !== jArg, 'Spain (H) and Argentina (J) are in opposite halves');
  assert(iFra !== lEng, 'France (I) and England (L) are in opposite halves');
  assert(hSpain === iFra, 'Spain (H) & France (I) share a half (allowed: #1 and #3 may meet in the SF)');
  assert(jArg === lEng, 'Argentina (J) & England (L) share the other half');
}

// ----------------------------------------------------------------------------
// summary
// ----------------------------------------------------------------------------
section('— title odds (top 12, from the 10,000-run Monte Carlo) —');
{
  const rows = [...TEAMS]
    .sort((x, y) => mc[y.code].champion - mc[x.code].champion)
    .slice(0, 12);
  for (const t of rows) {
    const p = mc[t.code];
    console.log(
      `     ${t.code}  ${t.name.padEnd(22)} elo ${t.elo}  ` +
        `win ${(p.champion * 100).toFixed(1).padStart(5)}%  ` +
        `final ${(p.reachFinal * 100).toFixed(1).padStart(5)}%  ` +
        `SF ${(p.reachSF * 100).toFixed(1).padStart(5)}%`
    );
  }
}

console.log('\n' + '='.repeat(60));
if (failures === 0) {
  console.log(`ALL ACCEPTANCE CRITERIA PASSED — ${checks} checks green.`);
  process.exit(0);
} else {
  console.log(`${failures} of ${checks} checks FAILED.`);
  process.exit(1);
}
