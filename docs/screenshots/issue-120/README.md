# Issue #120 — Elevskärm-dockan skymmer widget nere till höger

Lärarvy, Morgonskärmen, lokalt läge, testklass TEST-120. Widgets: analog
klocka (L) uppe till vänster, digital klocka (M) uppe till höger, Nedräkning
5:00 (L) nere till höger. Bra jobbat med sex namn. "Före" är epic-grenen
(`f8839d3`), "efter" är denna gren, serverade från samma adress.

Regel (efter leadens granskning): dockan flyttas bara till en plats som
varken skymmer kortet eller Bra jobbat-tavlan. Ryms ingen sådan plats står den
kvar och widget-panelen visar "Delvis dold av Elevskärm-panelen här — syns
fullt på elevskärmen." — hellre skymd widget i lärarvyn än skymt kort.

| Fil | Visar |
|---|---|
| `fore-larare-1920-morkt.png` / `-ljust.png` | Före: utfälld docka ligger över nedräkningen |
| `efter-larare-1920-morkt.png` / `-ljust.png` | Efter, utfälld: till vänster skulle den skymma kortets hörn, uppåt Bra jobbat → står kvar; panelen visar hinten under Nedräkning 1 |
| `efter-larare-1920-morkt-hopfalld.png` | Efter, hopfälld: längs nederkanten till vänster om nedräkningen; startknappen går att trycka på |
| `fore-larare-1280-morkt.png` / `-ljust.png` | Före: dockan täcker nedräkningen helt |
| `efter-larare-1280-morkt.png` / `-ljust.png` | Efter, utfälld: ingen plats utan att skymma kortet/Bra jobbat → står kvar + hinten |
| `fore-larare-1280-morkt-hopfalld.png` | Före: hopfälld docka över nedräkningens startknapp |
| `efter-larare-1280-morkt-hopfalld.png` | Efter, hopfälld: bredvid nedräkningen, fri från kortet (kontrollerat under kortets pendling) |
| `efter-larare-1024-ryms-inte-hint.png` | 1024 px, widgets i tre hörn: står kvar + hinten |

Elevskärmen är oförändrad: den har ingen docka och inga märkta element
(kontrollerat i `#/elev/morgon`). I Lektion och andra lägen står dockan
exakt som förut (`transform: none`).

Kortets bredd varierar mellan bilderna: kortet pendlar av sig självt vid
1280 px även på epic-grenen (rapporterat till leaden, inte #120).
