# Issue #146: Lektionsordning i stunden — bocka av steg + timer på pågående steg

Lokalt läge (Firebase-konfigurationen ersatt med platshållaren av en lokal
testserver, inget moln) med den påhittade klassen `TEST-146`. Planeringen:
Matematik, Vad/Hur/Varför, Lektionsordning med 4 steg ("Genomgång/Samling",
"Mini-whiteboards", "Mattebok s.44-45", "Avslut"), När du är klar "S. 62-63".
Ingen falsk klocka: lektionstiden lades runt den riktiga tiden, och lägena
(timer igång, Klart) sattes med riktiga tidsstämplar. "Före" är `1b2ccf5`
(main före #146), serverad från samma origin så att planeringen är densamma.

Elevskärmen i 1280×720 och 1920×1080; lärarvyn i 1280×800 (mörkt och ljust
tema — tavlans papper är vitt i alla teman, bara panelen skiljer).

| Bild | Vad |
|---|---|
| `1-fore-elev-{1280,1920}-inget-markerat` / `1-efter-…` | Inget steg markerat. **Pixelidentiska** (råa PNG-pixlar jämförda, båda storlekarna). |
| `2-elev-…-steg3-utan-timer` | Steg 1–2 bockade, steg 3 med ram + ton, ingen timer. |
| `3-elev-1280-matte-steg-halvvags`, `4-elev-1280-matte-steg-klart` | Stegtimern som bricka (`.lb-timer`): ifylld i ämnesfärgen, stapeln i nederkanten visar andelen tid kvar (halvvägs ≈ halv, Klart = tom; pulsen stoppad för bilden). |
| `5-elev-1280-slojd-steg-halvvags`, `5-elev-1280-slojd-steg-klart-och-efter-rasten` | Samma i ett ljust ämne (Slöjd, mörk text), och båda timrarna samtidigt med samma brickstil. |
| `6-elev-1920-matte-efter-rasten-och-steg` | 1920: Efter rasten halvvägs + stegtimern. |
| `7-larare-{morkt,ljust}-1280-bada-timrarna` | Lärarvyn i mörkt och ljust tema med båda brickorna. |
| `8-fore-elev-1280-efter-rasten-halvvags` / `8-efter-…` | Före (main `1b2ccf5`, genomskinlig timer) och efter (bricka med stapel), samma planering och tid. Uppmätt: `--lb-scale` 1.00 och `--lb-steps-scale` 0.94 i båda, timerns/rubrikradens höjd 86.81 px i båda och stegens radlägen identiska. |
| `9-efter-elev-1280-efter-rasten-fore-start` | Efter rasten före start: "10:00", full stapel. Rubriken "EFTER RASTEN" krymps hellre än hamnar under brickan (fitBreakLabel). |
| `10-elev-1280-efter-rasten-utan-timer` | Efter rasten med timern avstängd: ingen bricka. |

| `5-elev-1920-slojd-steg-halvvags` | Slöjd, stegtimer halvvägs, 1920. |
| `13-elev-1280-avslut-timer-efter-rasten` | Matematik, 4 steg, Efter rasten på, steg 4 "Avslut" pågår med timer (Testarens runda 3). Ramen ligger utanför raden och omsluter bubbla, text och bricka; sista steget slutar vid tavlans ram (#138), så ramens underkant sammanfaller med tavlans ram i ämnesfärgen. |
| `14-elev-1280-138-fallet-sista-steget` | 9 steg + Efter rasten, sista steget markerat: `--lb-steps-scale` 0.68 och identiska radhöjder utan och med markering (fitBoard räknar aldrig in markeringen). Ramen som i bild 13. |
| `12-larare-{ljust,morkt}-1920-slojd-steg` | Lärarvyn i 1920, ljust och mörkt tema. |

**Efter rasten vid Klart:** rutan tonas bort när tiden är ute (oförändrat
beteende), så Klart-läget för den brickan syns bara under bortoningen och
fångades inte på bild; stapeln är då tom (testat i Node).

**Finding 1 (kvarstår):** "Mattebok s.44-45" ryms inte på en rad bredvid
brickan när Lektionsordning har full storlek i 1280/1920 (rad 484 px, text
326 px, bubbla + mellanrum 84 px, bricka ≈ 155 px). När kolumnen är krympt
(t.ex. med Efter rasten-rutan, bilderna 5, 6 och 7) eller bredare står den
på en rad.

**Upptäckt på vägen:** rubriken "EFTER RASTEN" hamnade redan på main delvis
under timern i en trång kolumn ("10:00") — det syntes inte när timern var
genomskinlig text. Med den ifyllda brickan syntes det, så fitBoard krymper
nu bara rubrikens text tills den ryms (ändrar ingen höjd eller skala).

## Uppmätt i webbläsaren (elevskärmen 1280×720)

- Radhöjder och radernas läge är exakt lika utan markering, med bockar och
  med ram (4 steg: `31.80` px per rad i alla lägen). Med timer är det
  pågående steget lika högt som andra steg med lika många textrader
  (47.61 per rad, 95.22 för två rader i elevskärmen).
- Simulerade Segoe UI-mått (`@font-face` med `ascent-override: 108%;
  descent-override: 25%` på DejaVu Sans, som i #144), tät tavla (9 steg +
  Efter rasten): `--lb-scale` 0.79 och `--lb-steps-scale` 0.67 både utan
  markering och med 4 bockar + ram — radhöjderna identiska.
- Med timer på en lång rad: 0.78 / 0.70 (raden blir högre, tavlan anpassas
  som vanligt). Stoppa timer → tillbaka till 0.79 / 0.67.
- Timerbrickan överlappar aldrig texten och ligger inuti raden (mätt).
- Klart pulserar 1 → 0,5 → 1 på 1,8 s (uppmätt opacitet över en period).
- Scenariot: Nästa steg ×3, 20 min, +1 min efter Klart → 1:00 och räknar,
  Nästa steg → steg 3 bockat, timern borta, steg 4 markerat; elevskärmen
  följer via datalagret.
- Utgånget läge (igår): elevskärmen visar dagens tavla och skriver
  ingenting; lärarvyn nollställer de tre fälten en gång (`updatedAt`
  oförändrat efteråt).
