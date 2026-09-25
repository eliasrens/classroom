# Issue #26 — morgonskärmen: större text + Bra jobbat-tavlan i kolumner

Tagna i headless Chrome, elevvy (`#/elev/morgon`), 4 ikryssade uppgifter.
`fore-*` = före ändringen, `efter-*` = efter.

## Textstorlek (elevvy, beräknad font-size)

| | 1920×1080 före | 1920×1080 efter | 1280×720 före | 1280×720 efter |
|---|---|---|---|---|
| Hälsning | 101 px | 122 px | 77 px | 82–86 px |
| Att-göra-rad | 48 px | 64 px | 38 px | 43 px |
| Namn, 3 st | 53 px | 66 px | 38 px | 46 px |

Lärarvyn (1920×1080): hälsning 54 → 77 px, uppgifter 25 → 35 px.

På 720p begränsas hälsning och lista av skärmhöjden (vh) och kortets
bredd (cqi) så att kortet inte behöver scrolla och hälsningen inte bryts.

## Namntavlan — verifiering

För varje kombination kontrollerades: ingen scroll i listan eller rutan,
alla namn inom rutan och på skärmen, rutan överlappar inte kortet.

| Namn | 1920×1080 | 1280×720 |
|---|---|---|
| 3  | 1 kolumn, 66 px | 1 kolumn, 46 px |
| 12 | 2 kolumner, 56 px | 2 kolumner, 36 px |
| 25 | 2 kolumner, 43 px | 2 kolumner, 28 px |
| 30 | 2 kolumner, 37 px | 2 kolumner, 24 px (minsta = 1.1rem) |

Före: 30 namn gav en scrollist (`fore-*-30.webp`), bara ~10 namn syntes.

(Stjärnan i rubriken visas som en ruta i headless Chrome — ingen emoji-font där.)
