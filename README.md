# World Cup 2026 Simulator

Interactive FIFA World Cup 2026 simulator (USA · Canada · Mexico, 11 June – 19 July 2026).
Real groups, real calendar, real bracket structure. Team strength is driven **only** by Elo
rating — no hand-tuning, no per-team boost. Hosts get the standard eloratings +100 when playing
in their own country.

Two modes:

- **Single tournament** — play one full tournament match-by-match; watch the group tables fill in,
  then the knockout bracket and final result.
- **Monte Carlo** — run the tournament many times (default 10,000) and show each team's
  stage-reach probabilities (win group %, reach R16/QF/SF/final %, win tournament %).

This is the **engine + data + raw UI** (Cowork phase). A later **Code phase** will add canvas
animations, bracket transitions, and a 2D goal-event replay — the DOM is already built with
`data-*` attributes and empty `.flag-slot` hooks so visuals plug in **without touching the engine**.

## Stack

Vanilla JS, **no framework, no build step**. ES modules, loaded with plain `<script type="module">`.
The engine (`engine.js`) imports nothing from the UI and references no DOM, so it runs unchanged in
**Node and the browser** — which is what lets the test suite run headless.

## Files

| File | Layer | Notes |
|------|-------|-------|
| `data.js` | Data | Pure static data, zero logic: 48 teams (Elo + world rank), 12 groups, 72-match group calendar, knockout structure with slot logic. |
| `engine.js` | Engine | Deterministic, seeded simulation. No UI/DOM. |
| `test.js` | Tests | Headless acceptance suite — `node test.js`. |
| `index.html` + `ui.js` | UI | Raw, minimally styled, no animations. Mode toggle, group tables, bracket, podium, Monte Carlo table. |

## Run

```bash
# headless acceptance tests (no dependencies)
node test.js

# the UI — serve over http(s); file:// is blocked by ES-module CORS
python -m http.server 8000      # then open http://localhost:8000
```

## Engine model

- **Elo → expected goals.** Each match's Elo difference (incl. the host bonus) is turned into a
  per-team win expectancy `We = 1 / (10^(-Δ/400) + 1)`, then into expected goals as a split of a
  fixed 2.7 total (`expGoals = 2.7 · We`), floored at a small positive value. Because the two sides'
  expectations sum to ~2.7, the **mean total goals per match is ≈ 2.7 by construction**, not by
  hand-tuning.
- **Independent Poisson per team** → score + a goal-event stream (minute + scoring side).
- **Knockout draws:** extra time (a lower goal-expectation window), then a penalty shootout
  (near-coinflip with a slight Elo lean).
- **Seeded RNG** (mulberry32), threaded explicitly through every stochastic function. Same seed →
  identical tournament — this powers both reproducible Monte Carlo and the future replay feature.
- **Tiebreakers** within a group: points → goal difference → goals scored → head-to-head
  (within-group only). Third-placed teams are ranked across groups by points → GD → goals scored →
  conduct → world rank (no head-to-head, since they are from different groups).

## Two documented extension points (swap in later, no caller changes)

1. **Third-place assignment.** FIFA's official 495-row third-place lookup table is intentionally
   **out of scope**. `assignThirdPlaces()` ships a deterministic rank-and-assign fallback: it
   matches the 8 qualifying thirds to the group winners of A, B, D, E, G, I, K, L via bipartite
   matching that honors the **no-same-group-rematch** constraint. Replacing the body of that one
   function with the 495-row lookup requires no change to callers.
2. **Dixon-Coles low-score correction.** Independent Poisson slightly under-predicts draws and
   tight low-scoring games. `applyLowScoreCorrection()` is a clearly-commented **no-op hook** where
   the Dixon-Coles τ correction can be dropped in later.

## ⚠️ One inferred data structure (flagged)

The source data specifies the **R32 matchups and slot logic** exactly, plus the **venues/dates** for
R16 → Final. It does **not** publish the explicit cross-bracket pairing tree (which R32 winner meets
which in R16, etc.). `data.js` therefore pairs winners **sequentially** (`R32_1 ∧ R32_2 → R16_1`, …),
encoded as swappable `feeds` data. Substituting FIFA's official bracket map later requires editing
only `KNOCKOUT_ROUNDS` in `data.js` — the engine is unaffected. Consequently the brief's
"top-4 seeds kept to opposite halves" property is approximate in this build.

## Acceptance criteria (all proven by `node test.js`)

1. **Determinism** — `simulateTournament(42)` twice is byte-identical; different seeds differ.
2. **Calibration** — over 10,000 matches, mean total goals = 2.7 ± 0.15.
3. **Structural validity** — every tournament has exactly 32 R32 teams (24 direct + 8 thirds), no
   team twice, no third-placer facing its own group winner, and a single clean champion.
4. **Monte Carlo sanity** — over 10,000 runs, per-team stage probabilities are monotone and the
   population sums are exact (one champion, two finalists, … one winner per group); Spain / Argentina
   / France top the title odds, Qatar / Curaçao sit at the bottom.
5. **Home advantage** — a host playing at home wins measurably more than the same matchup as neutral.

## Data sources

All tournament data is transcribed from the project's `BRIEF.md` and `DATA-VERIFIED.md`
(verified 30 May 2026; Elo from eloratings.net). Where the two disagreed, the verified addendum won.

## Deploy

Target: **`wc2026.evers.no`** (GitHub Pages, custom domain). The repo root is the site root, so
assets use relative/root-relative paths — no project base-path prefix. `CNAME` contains the custom
domain. DNS (`wc2026 → valiantevers.github.io`) is configured separately.

## License

MIT.
