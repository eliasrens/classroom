# Issue #71 — morgonskärmens Bra jobbat-ruta

Headless Chrome, lokalt läge (apiKey `FYLL_I…`), påhittad klass TEST-71,
fritextnamn, två ikryssade uppgifter. `fore-*` = main före ändringen,
`efter-*` = den här grenen. (Stjärnan i före-bilderna och lektionsrutan
visas som en ruta: headless Chrome saknar emoji-typsnitt.)

## Mätningar (getComputedStyle / getBoundingClientRect, CSS-px)

| Vy | Storlek | Namn | Uppgiftsrad | Namn | Rubrik | Kolumner | Rutans höjd | Ingen scroll · alla syns · ej över kortet |
|---|---|---|---|---|---|---|---|---|
| elev | 1920×1080 | 5  | 57.2 | 57.2 | 74.3 | 1 | 565 | ✓ |
| elev | 1920×1080 | 12 | 57.2 | 57.2 | 74.3 | 2 | 648 | ✓ |
| elev | 1920×1080 | 30 | 54.6 | 44.5 | 74.3 | 3 | 799 | ✓ |
| elev | 1366×768  | 5  | 41.3 | 41.3 | 53.7 | 1 | 429 | ✓ |
| elev | 1366×768  | 12 | 41.3 | 41.3 | 53.7 | 2 | 489 | ✓ |
| elev | 1366×768  | 30 | 37.8 | 29.3 | 49.0 | 3 | 552 | ✓ |
| lärare | 1920×1080 | 5  | 31.5 | 31.5 | 41.0 | 1 | 346 | ✓ |
| lärare | 1920×1080 | 12 | 31.5 | 31.5 | 41.0 | 1 | 666 | ✓ |
| lärare | 1920×1080 | 30 | 31.5 | 31.5 | 41.0 | 2 | 803 | ✓ |
| lärare | 1366×768  | 5  | 28.9 | 28.9 | 37.6 | 1 | 323 | ✓ |
| lärare | 1366×768  | 12 | 28.9 | 28.9 | 37.6 | 2 | 365 | ✓ |
| lärare | 1366×768  | 30 | 27.1 | 22.8 | 35.0 | 3 | 442 | ✓ |

Med 30 namn når rutan sin största bredd (samma gräns som förut) och först
då krymper namnen under uppgiftsradens storlek. Lärarvyn mättes också efter
att panelen fällts in och ut igen (namn = uppgift inom 0,05 px).

Lektionsplaneringens Bra jobbat-ruta (12 namn, 1920×1080): före och efter
identisk — ruta 280×458 px, rubrik "⭐ Bra jobbat!" 22.3 px, namn 29.3 px
(`fore-lektion-1920.jpeg`, `efter-lektion-1920.jpeg`).

Elevskärms-rutan i lärarvyns nedre högra hörn ligger ovanpå tavlan precis
som före ändringen (den kan fällas ihop); den ändras inte här.
