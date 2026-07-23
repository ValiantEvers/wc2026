// =============================================================================
// backtest.js — retrospective scoring of the FROZEN pre-tournament model against
// the actual 2026 results. PURE + HEADLESS (like engine.js): imports only the
// engine's public model + static data, references no DOM, runs in Node and the
// browser. The forward simulation never touches this; the model has no knowledge
// of the outcome — this file grades it after the fact.
//
// What it measures, for every one of the 104 matches that were actually played:
//   the model's pre-match W/D/L forecast (from the SAME Elo->Poisson core the
//   simulator uses, at the real venue) vs the real 90-minute result. Scored with
//   RPS (the football-forecasting standard), multiclass Brier, and log-loss,
//   split group vs knockout, plus a reliability (calibration) breakdown.
//
// The champion / title-odds forecast is the forward Monte Carlo (engine.js
// monteCarlo) and is compared separately in the UI — it needs no results.
// =============================================================================

import { expectedGoals, teamByCode } from './engine.js';
import { GROUP_MATCHES, KNOCKOUT_R32, KNOCKOUT_ROUNDS } from './data.js';
import { RESULTS } from './results.js';

// ---- venue lookups from the model's own frozen fixture data -----------------
// Group: a team-pair occurs at most once in the whole group stage, so the
// unordered code pair is a unique key. Knockout: keyed by FIFA match number.
const pairKey = (a, b) => [a, b].sort().join('|');
const GROUP_VENUE = {};
for (const m of GROUP_MATCHES) GROUP_VENUE[pairKey(m.a, m.b)] = m.venueCountry;

const KO_ROUND_NUM = {
  M89: 89, M90: 90, M91: 91, M92: 92, M93: 93, M94: 94, M95: 95, M96: 96,
  M97: 97, M98: 98, M99: 99, M100: 100, M101: 101, M102: 102, THIRD: 103, FINAL: 104,
};
const KO_VENUE = {};
for (const m of KNOCKOUT_R32) KO_VENUE[parseInt(m.id.slice(1), 10)] = m.venueCountry;
for (const rnd of KNOCKOUT_ROUNDS) for (const m of rnd.matches) KO_VENUE[KO_ROUND_NUM[m.id]] = m.venueCountry;

function venueFor(r) {
  return r.stage === 'group' ? GROUP_VENUE[pairKey(r.a, r.b)] : KO_VENUE[r.num];
}

// ---- model W/D/L for a matchup, analytic from two independent Poissons -------
function poissonPmf(lambda, kmax = 15) {
  const out = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= kmax; k++) { out.push(p); p = (p * lambda) / (k + 1); }
  return out;
}
// Returns [P(a win), P(draw), P(b win)] at 90 minutes.
export function modelWDL(codeA, codeB, venueCountry) {
  const { expA, expB } = expectedGoals(teamByCode(codeA), teamByCode(codeB), venueCountry);
  const pa = poissonPmf(expA), pb = poissonPmf(expB);
  let win = 0, draw = 0, loss = 0;
  for (let i = 0; i < pa.length; i++) {
    for (let j = 0; j < pb.length; j++) {
      const pr = pa[i] * pb[j];
      if (i > j) win += pr; else if (i === j) draw += pr; else loss += pr;
    }
  }
  const s = win + draw + loss; // ~1 minus a tiny truncation tail; renormalise
  return [win / s, draw / s, loss / s];
}

// ---- proper scoring rules (3 ordered outcomes: A win, draw, B win) ----------
// RPS = mean squared error of the cumulative forecast vs the cumulative outcome.
export function rps(p, o) {
  const O = [0, 0, 0]; O[o] = 1;
  let cp = 0, co = 0, s = 0;
  for (let k = 0; k < 2; k++) { cp += p[k]; co += O[k]; s += (cp - co) ** 2; }
  return s / 2;
}
export function brier(p, o) { const O = [0, 0, 0]; O[o] = 1; return p.reduce((a, x, i) => a + (x - O[i]) ** 2, 0); }
export function logloss(p, o) { return -Math.log(Math.max(p[o], 1e-12)); }

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function summarize(rows) {
  return {
    n: rows.length,
    rps: mean(rows.map(r => r.rps)),
    brier: mean(rows.map(r => r.brier)),
    logloss: mean(rows.map(r => r.logloss)),
    favHit: mean(rows.map(r => (r.favHit ? 1 : 0))), // draws count as a miss for the favourite
  };
}
function uniform(rows) {
  const u = [1 / 3, 1 / 3, 1 / 3];
  return { rps: mean(rows.map(r => rps(u, r.o))), brier: mean(rows.map(r => brier(u, r.o))), logloss: mean(rows.map(r => logloss(u, r.o))) };
}
// Reliability: bucket every (match, outcome-category) forecast probability into
// 10 bins; compare mean predicted probability with observed frequency.
function calibration(rows) {
  const bins = Array.from({ length: 10 }, () => ({ sumP: 0, occ: 0, n: 0 }));
  for (const r of rows) for (let k = 0; k < 3; k++) {
    const pk = r.p[k];
    const bi = Math.min(9, Math.floor(pk * 10));
    bins[bi].sumP += pk; bins[bi].occ += (r.o === k ? 1 : 0); bins[bi].n += 1;
  }
  return bins.map((b, i) => ({
    lo: i / 10, hi: (i + 1) / 10, n: b.n,
    pred: b.n ? b.sumP / b.n : null,
    obs: b.n ? b.occ / b.n : null,
  }));
}

// ---- champion / title-odds report (from the forward Monte Carlo) ------------
// Published pre-tournament title odds for Spain, for benchmarking the model's
// concentration: Opta supercomputer 16.1%; Groll/Zeileis/Hvattum 14.5%.
export const BENCHMARK = { opta: 0.161, gzh: 0.145 };
// What actually happened.
export const REAL = { champion: 'ESP', finalists: ['ESP', 'ARG'], semifinalists: ['ESP', 'ARG', 'FRA', 'ENG'] };

const setEq = (x, y) => x.length === y.length && x.every(e => y.includes(e));

// mc = engine.js monteCarlo(n, 1) output { code: { champion, reachFinal, reachSF, ... } }.
export function championReport(mc) {
  const list = Object.entries(mc)
    .map(([code, v]) => ({ code, name: teamByCode(code).name, champion: v.champion, reachFinal: v.reachFinal, reachSF: v.reachSF }))
    .sort((a, b) => b.champion - a.champion);
  const spain = list.find(c => c.code === REAL.champion).champion;
  const top2 = list.slice(0, 2).map(c => c.code);
  const top4 = list.slice(0, 4).map(c => c.code);
  return {
    top: list.slice(0, 8),
    spain,
    benchmark: BENCHMARK,
    real: REAL,
    // Single-realisation champion log-loss (Spain won, so only P(Spain) matters).
    championLL: { model: -Math.log(spain), opta: -Math.log(BENCHMARK.opta), gzh: -Math.log(BENCHMARK.gzh) },
    hits: {
      champion: list[0].code === REAL.champion,
      finalists: setEq(top2, REAL.finalists),
      semifinalists: setEq(top4, REAL.semifinalists),
    },
  };
}

// ---- main entry -------------------------------------------------------------
export function computeBacktest() {
  const rows = RESULTS.map(r => {
    const venue = venueFor(r);
    const p = modelWDL(r.a, r.b, venue);
    const [g1, g2] = r.ft;
    const o = g1 > g2 ? 0 : g1 === g2 ? 1 : 2;           // actual 90' outcome index
    const favIdx = p[0] >= p[2] ? 0 : 2;                 // model's favourite side
    return {
      ...r, venue, p, o,
      rps: rps(p, o), brier: brier(p, o), logloss: logloss(p, o),
      favProb: Math.max(p[0], p[2]),
      favHit: favIdx === o,
      surprise: -Math.log(Math.max(p[o], 1e-12)),        // how shocked the model was
    };
  });
  const group = rows.filter(r => r.stage === 'group');
  const ko = rows.filter(r => r.stage === 'ko');
  return {
    perMatch: { all: summarize(rows), group: summarize(group), ko: summarize(ko) },
    baseline: { all: uniform(rows), group: uniform(group), ko: uniform(ko) },
    calibration: { group: calibration(group), ko: calibration(ko) },
    rows,
  };
}
