# Issue #120 — Elevskärm-dockan skymmer widget nere till höger

Lärarvy, Morgonskärmen, lokalt läge, testklass TEST-120. Widgets: analog
klocka (L) uppe till vänster, digital klocka (M) uppe till höger, Nedräkning
5:00 (L) nere till höger. Bra jobbat med sex namn. "Före" är epic-grenen
(`f8839d3`), "efter" är denna gren, serverade från samma adress.

| Fil | Visar |
|---|---|
| `fore-larare-1920-morkt.png` / `-ljust.png` | Före: utfälld docka ligger över nedräkningen (och nedre delen av Bra jobbat) |
| `efter-larare-1920-morkt.png` / `-ljust.png` | Efter: dockan står till vänster om nedräkningen; widget, kort och Bra jobbat syns |
| `fore-larare-1280-morkt.png` / `-ljust.png` | Före: dockan täcker nedräkningen helt och halva Bra jobbat |
| `efter-larare-1280-morkt.png` / `-ljust.png` | Efter: nedräkning och Bra jobbat syns; dockan täcker i stället kortets högra kant (det dockan själv förhandsvisar) |
| `fore-larare-1280-morkt-hopfalld.png` | Före: hopfälld docka över nedräkningens startknapp |
| `efter-larare-1280-morkt-hopfalld.png` | Efter: hopfälld docka längs nederkanten bredvid nedräkningen |
| `efter-larare-1280-morkt-tre-horn.png` | Widgets i tre hörn: dockan hittar luckan mellan de två nedre widgetarna |
| `efter-larare-1024-ryms-inte-hint.png` | 1024 px: dockan ryms ingenstans, står kvar, och panelen säger "Delvis dold av Elevskärm-panelen här — syns fullt på elevskärmen." |

Elevskärmen är oförändrad: den har ingen docka och inga märkta element
(kontrollerat i `#/elev/morgon`). I Lektion och andra lägen står dockan
exakt som förut (`transform: none`).

Kortets bredd varierar mellan bilderna: kortet pendlar av sig självt vid
1280 px även på epic-grenen (rapporterat till leaden, inte #120).
