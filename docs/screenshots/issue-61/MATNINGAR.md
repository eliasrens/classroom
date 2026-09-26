# Issue #61 — mätningar av sidramen

Headless Chrome, lokalt läge (apiKey `FYLL_I…`), påhittad klass TEST-61 med 12 elever. `getBoundingClientRect()` i CSS-px. `tabs` = `.page-tabs`, `innehåll` = blocket direkt under flikraden (eller lägets första rad om sidan saknar flikar). Topbaren slutar på y = 48.

| Storlek | Sida | Flikrad x / top / bredd / höjd | Innehåll | x / top / bredd |
|---|---|---|---|---|
| 1920x1080 | oversikt-idag | 273 / 60 / 1360 / 43 | `ov-panel` | 273 / 123 / 1360 |
| 1920x1080 | oversikt-veckor | 273 / 60 / 1360 / 43 | `ov-panel` | 273 / 123 / 1360 |
| 1920x1080 | oversikt-atgarder | 273 / 60 / 1360 / 43 | `ov-panel` | 273 / 123 / 1360 |
| 1920x1080 | oversikt-installningar | 273 / 60 / 1360 / 43 | `ov-panel` | 273 / 123 / 1360 |
| 1920x1080 | elever-registrera | 273 / 60 / 1360 / 43 | `elever__body` | 273 / 123 / 1360 |
| 1920x1080 | elever-elever | 273 / 60 / 1360 / 43 | `elever__body` | 273 / 123 / 1360 |
| 1920x1080 | lektion | — | `lesson-panel` | 273 / 60 / 360 |
| 1920x1080 | trafikljus | — | `tl-kind-row` | 473 / 60 / 960 |
| 1920x1080 | skriv | — | `skr-toolbar` | 273 / 60 / 1360 |
| 1920x1080 | lotta | — | `lot-main` | 273 / 60 / 1040 |
| 1920x1080 | karta | — | `kt-main` | 273 / 60 / 1060 |
| 1920x1080 | vecka | — | `vk-toolbar` | 273 / 60 / 1360 |
| 1920x1080 | morgon | — | `morgon__bgimg` | 0 / 48 / 1920 |
| 1366x768 | oversikt-idag | 20 / 60 / 1311 / 42 | `ov-panel` | 20 / 122 / 1311 |
| 1366x768 | oversikt-veckor | 20 / 60 / 1311 / 42 | `ov-panel` | 20 / 122 / 1311 |
| 1366x768 | oversikt-atgarder | 20 / 60 / 1311 / 42 | `ov-panel` | 20 / 122 / 1311 |
| 1366x768 | oversikt-installningar | 20 / 60 / 1311 / 42 | `ov-panel` | 20 / 122 / 1311 |
| 1366x768 | elever-registrera | 20 / 60 / 1311 / 42 | `elever__body` | 20 / 122 / 1311 |
| 1366x768 | elever-elever | 20 / 60 / 1311 / 42 | `elever__body` | 20 / 122 / 1311 |
| 1366x768 | lektion | — | `lesson-panel` | 20 / 60 / 360 |
| 1366x768 | trafikljus | — | `tl-kind-row` | 196 / 60 / 960 |
| 1366x768 | skriv | — | `skr-toolbar` | 20 / 60 / 1311 |
| 1366x768 | lotta | — | `lot-main` | 20 / 60 / 991 |
| 1366x768 | karta | — | `kt-main` | 20 / 60 / 1011 |
| 1366x768 | vecka | — | `vk-toolbar` | 20 / 60 / 1311 |
| 1366x768 | morgon | — | `morgon__bgimg` | 0 / 48 / 1366 |

Övriga bredder (samma mätskript): 1280 px → flikrad/innehåll x 20, top 60, bredd 1225; 1024 px → x 20, top 60, bredd 969; 800 px → sidomarginal 12 px överallt (topbaren bryts till två rader, top 102).

Medvetet avvikande: `morgon` är fullbleed; `trafikljus` är en centrerad 960 px-kolumn inom ramen (samma top).
