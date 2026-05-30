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

## Knockout bracket — official fixed tree

The full knockout bracket uses FIFA's **official fixed tree** (match numbers 73–104). The
cross-bracket pairings are fixed and result-independent, and the R16 winners **cross** (they do
*not* pair sequentially) — which is what preserves the "top seeds in opposite halves" guarantee.
The half structure is verified by an acceptance check: Spain (group H) and Argentina (group J) land
in opposite halves, as do France (group I) and England (group L). Spain and France sharing the upper
half is correct — #1 and #3 may meet in a semifinal, just not before.

The tree lives in the swappable `KNOCKOUT_ROUNDS` block in `data.js`; the engine resolves it
generically by match id, so any future change is data-only. (R16/QF/SF *venue* assignments within a
round come from the brief's venue pools and are best-effort display values — but the bracket tree
itself is exact.)

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
