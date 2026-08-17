# fonts/

Selvhostet webfont for `evers.no/wc2026` — **ingen tredjepartskall** (ingen
fonts.googleapis.com / fonts.gstatic.com). Samme mønster som
`ValiantEvers.github.io/fonts/`: inline `@font-face` i `index.html` med
`unicode-range`-splitt per subset.

## Archivo

Variabel font, `wght`-akse. **Én fil per subset dekker alle vekter** — siden bruker
500, 600, 700, 800 og 900, som tidligere kostet fem statiske filer fra Google.

| Fil | Subset | Størrelse |
|---|---|--:|
| `archivo-latin-wght-normal.woff2` | latin | 34,9 kB |
| `archivo-latin-ext-wght-normal.woff2` | latin-ext | 32,6 kB |

Kilde: [`@fontsource-variable/archivo@5`](https://www.npmjs.com/package/@fontsource-variable/archivo),
hentet 2026-08-17 fra jsDelivr. Archivo er lisensiert under **OFL-1.1**
(Omnibus-Type), som tillater redistribusjon.

## Subsettdekning — sjekket, ikke antatt

Alle ikke-ASCII-tegn i sidens innhold ligger i `latin`: § ± · É × ç é ø ü. Ingen
trenger `latin-ext`, men den shippes likevel fordi husets README foreskriver det og
fordi den bare lastes hvis et tegn i området faktisk brukes.

Ett tegn faller utenfor begge: **Σ (U+03A3)**. Det står kun i `test.js` som etikett i
konsoll-utskrift («Σ champion% = 1»), aldri i noe som rendres. Archivo har uansett
ikke noe greek-subset hos fontsource, så Google-URL-en dekket det heller ikke — å
selvhoste endrer altså ingenting for det tegnet.

## Ved oppdatering

Hent samme to filnavn fra samme pakke og la `@font-face`-blokkene i `index.html` stå.
Endres vektbruken i `styles.css`, trengs ingen nye filer — `font-weight:100 900`
dekker hele aksen.
