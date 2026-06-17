# wc2026 — instruks for Claude Code-økter

Interaktiv FIFA World Cup 2026-simulator. Vanilla JS, **ingen rammeverk, ingen bygg-steg**
(ES-moduler). Live på **evers.no/wc2026**. Les `README.md`.

## Arkitektur — ikke bryt lagdelingen
- `engine.js` er **ren og headless**: importerer ingenting fra UI-et, refererer ingen DOM →
  kjører uendret i Node og nettleser (det er det som lar testene kjøre headless).
- `data.js` (ren statisk data, null logikk), `ui.js`/`index.html` (UI), `replay.js`
  (2D-replay; muterer ikke engine-state). Visuelt lag kobles på via `data-*`/`.flag-slot`-hooks
  **uten å røre engine**.
- **Determinisme er akseptansekrav:** seedet RNG (mulberry32) trås eksplisitt gjennom hver
  stokastisk funksjon — samme seed → byte-identisk turnering. Ikke introduser global/useedet
  tilfeldighet.
- To tilsiktede utvidelsespunkter er bevisste no-op-hooks: `assignThirdPlaces()` (495-rads
  FIFA-tabell out of scope) og `applyLowScoreCorrection()` (Dixon-Coles). Ikke fyll dem uten grunn.

## Konvensjoner (gjelder alle endringer)
- Innhold/identifikatorer engelsk (matcher eksisterende repo). Datoer ISO 8601.
- Commit-prefiks fri men beskrivende (`feat:`/`fix:`/`docs:`/`polish:`). Aldri Co-Authored-By.
- `git pull --rebase origin main` før push.

## Data og verifisering
- All turneringsdata transkribert fra `BRIEF.md` + `DATA-VERIFIED.md` (verifisert 2026-05-30;
  Elo fra eloratings.net). Ved konflikt vant det verifiserte tillegget.
- `node test.js` — headless akseptanse (determinisme, kalibrering ~2,7 mål/kamp, struktur,
  Monte Carlo-sanity, hjemmefordel). CI (`ci.yml`) kjører den på hver push.

## Bygg / deploy
- Serveres fra repo-rot via GitHub Pages (project page under `evers.no` — arver domenet, **ingen
  egen CNAME**). Push til `main` publiserer. UI må serveres over http(s) (file:// blokkeres av
  ES-module-CORS).
