# Issue #115 — skärmdumpar

Lokalt läge, påhittad testklass `QA-TEST-115`. Före = koden före #115
(`git archive` av grenens bas), efter = #115 — samma server och port, så
localStorage och data är identiska.

## Tavla utan widgets: före = efter

`utan-widgets-fore-*.png` / `utan-widgets-efter-*.png` är tavlan (lärarvyn:
beskuren till `.lesson-board` + 4 px; elevvyn: hela skärmen), i mörkt och
ljust tema, 1920 × 1080 och 1280 × 800. Pixeljämförelse (RGB, varje pixel):

| Vy | Hela skärmen | Tavlan |
|---|---|---|
| lärare mörk 1920 | 2085 px olika (den nya sektionen "Widgets" i panelen) | **0** |
| lärare ljus 1920 | 2113 px olika (panelen) | **0** |
| lärare mörk 1280 | 854 px olika (panelen) | **0** |
| lärare ljus 1280 | 878 px olika (panelen) | **0** |
| elev 1920 | **0** | **0** |
| elev 1280 | **0** | **0** |

Tavlans `outerHTML`, `--lb-scale` (0.90 / 0.89) och position är också
identiska före och efter.

## Klockbrickan

- `klockbricka-larare-mork-1920.png` — lärarvy, sektionen Widgets öppen.
  Rubrikradens höjd (115,42 px) och `--lb-scale` (0.90) är samma som utan bricka.
- `klockbricka-larare-ljus-1280.png`, `klockbricka-elev-1920.png`, `klockbricka-elev-1280.png`
- `klockbricka-elev-ljust-amne-1920.png` — ljust ämne (Slöjd): brickan tar
  rubrikens mörka text.

## Morgonskärmen

- `morgon-elev-klocka-{tl,tr,bl,br}-{S,L}.png` — elevskärmen, klockan i varje
  hörn i S och L (ändrad i lärarfönstret, synkad live till elevfönstret).
- `morgon-larare-krock-tr-flyttad.png` / `morgon-elev-krock-tr-flyttad-till-tl.png`
  — klockan i L uppe till höger skulle skymma en lång Bra jobbat-tavla
  (nere till höger likaså) → visas uppe till vänster i båda fönstren;
  panelen förklarar varför.
