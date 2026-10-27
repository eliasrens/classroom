# Issue #144: Lektionsordning och Efter rasten-rutan krymps i stor storlek trots plats

Lokalt läge (Firebase-konfigurationen ersatt med platshållaren av en lokal
testserver, inget moln) med den påhittade klassen `TEST-144`. Planeringen
enligt issuen: Geografi 08:00–09:20, Vad "Addition", Hur "Mini-whiteboards
och mattebok", Varför "Bli säkrare på addition", Lektionsordning med 4 steg
("Genomgång/Samling", "Mini-whiteboards", "Mattebok s.44-45", "Avslut"), När
du är klar "S. 62-63", ingen bottenrad, "Efter rasten" med `Kör på/1/2` och
timer 10 min. Ytorna: lärarens förhandsvisning i ett 1570 px brett fönster
(tavlan 1095 px, font 31.2 px), miniatyren av elevskärmen (en hel elevskärm
1280×720 i en iframe, nedskalad 0.2328 — tavlan 1209 px, font 34.5 px) och
elevskärmen 1920×1080 (tavlan 1849 px, font 52.7 px). "Före" är `main`
(`f5632d2`). Före-bilderna togs med en första variant av planeringen
(samma struktur, andra texter: "Vi räknar i boken", "Räkna själv" …).

## Grundorsak: glyfer som sticker ut ur raden räknades som överflöd

Agenternas Linux-Chromium (DejaVu Sans, innehållsyta 1.16 em) återskapade
aldrig felet: med lärarens planering blir `--lb-steps-scale` 0.97–0.99 och
`--lb-break-scale` 1 i alla tre ytorna, och kolumnen är full ner till ramen.

Lärarens dator renderar tavlan med **Segoe UI** (`--font-family` i
css/tokens.css). Segoe UI:s glyfer har innehållsytan 1.33 em (ascent 1.079 +
descent 0.251), mer än tavlans line-height: 1.28 i brödtexten, 1.2 i timern,
1.1 i etiketterna. Chrome räknar det som sticker ut under sista raden
((1.33 − line-height)/2 per rad) in i `scrollHeight`, så `scrollHeight >
clientHeight + 1` var sant i rubrikraden `.lb-break__head` (timern, 2.1 em)
vid **varje** skala. Det är exakt det CSS-kommentaren vid
`.lb-break__time { line-height: 1.2 }` varnade för — men marginalen räckte
bara för Linux-typsnitten.

Tvingade fontmått i agentens Chromium (`@font-face` med `ascent-override:
108%; descent-override: 25%` på DejaVu Sans = Segoe UI:s mått, "WinSim" i
bildnamnen) återskapar felet exakt, på `main`:

| Yta (main, WinSim) | `--lb-scale` | steg | ruta | Överflödande nod | Resultat |
|---|---|---|---|---|---|
| Elevskärm 1920 | 1.00 | **0.45** | **0.45** | `.lb-break__head` 138 → 132 px (+6), `.lb-break__time` (+6), `.lb-break__body` | Rutan 185 px hög, sista steget vid y = 586 av 1037 (43 % av kolumnen) |
| Förhandsvisning 1570 | 1.00 | 1.00 | **0.47** | `.lb-break__head` 82 → 79 px (+3), `.lb-break__time` | Rutan 131 px, sista steget vid 502 av 613 |
| Miniatyr (1280×720) | 1.00 | 1.00 | **0.47** | `.lb-break__head` (+3) | som förhandsvisningen |

Rutans höjd **185 px** på elevskärmen är precis vad läraren mätte i sin
skärmbild ("ca 185 px hög") — det är rutan på skalan 0.45, inte rutans
riktiga höjd (404 px vid skala 1). Händelseförloppet i `fitMidColumn`:
`fits()` (som innehöll `overflows(midEl)`) är falsk i alla skalor →
Lektionsordning går till golvet 0.45 → `breakFits()` (samma glyfer) är
också falsk → rutan söks ner tills glyfernas överflöd avrundas till 1 px
(0.45–0.47) → stegen räknas om och ryms ibland på 1 (förhandsvisningen),
ibland inte alls (elevskärmen, där rutan på 0.45 + stegen på 1 åter ger
`.lb-break__head`-överflöd > 1 px vid den större fonten).

Varför **miniatyren kan se rätt ut** medan den stora ytan är fel: glyfernas
överflöd växer med fontstorleken (0.025–0.065 em) medan toleransen är fast
1 px, och `scrollHeight`/`clientHeight` är heltal. Vid liten font avrundas
överflödet bort, vid stor font blir det 2–6 px. I agentens emulering (ingen
pixelavrundning av fontmåtten, iframe-fonten 34 px ≈ förhandsvisningens
31 px) faller miniatyren på samma sida som förhandsvisningen; på Windows
avrundar Chrome fontmåtten till hela pixlar per storlek, så gränsen ligger
annorlunda. Oavsett: felet beror på storleken, inte planeringen.

Övrigt som undersöktes och **inte** är orsaken: `fitBoard` körs aldrig med
en dold/0-hög scen (ResizeObserver på scenen + `document.fonts.ready` i
både förhandsvisning och elevvy; helskärm och resize ger ny mätning);
clampen `clamp(9px, 2.85cqi, 60px)` slår inte i på någon av ytorna
(31–53 px); dpr 1.25/1.5 och zoom 110 % ändrar inget.

### `--lb-scale` med och utan ruta

Läraren uppfattade Vad/Addition/När du är klar som större med rutan än i
referensbilden utan. Uppmätt (main och efter, WinSim och standardfont, dpr
1 och 1.25): `--lb-scale` = **1.00** i båda fallen på alla ytor, tavlans
font 52.7 px, och utan ruta slutar sista steget vid y = 606 av 1037 — vilket
stämmer med referensbildens "≈620 av 1055". Tavlans skala räknas utan rutan
(den är `display:none` under steg 1) och den beräkningen är densamma med
och utan. Skillnaden i lärarens två bilder gick inte att återskapa; de
måste ha tagits vid olika fönsterstorlek eller webbläsarzoom (fonten följer
tavlans bredd, 2.85 cqi). Efter rättningen är mätningen i steg 1 dessutom
geometrisk, så inte heller glyf-avrundning kan ge olika skala.

## Rättning (commit `6345419` + den här)

1. **Ryms-kontrollen mäter geometri, inte `scrollHeight`** (`overflows()` i
   js/modes/lektion.js): innehållets underkant = sista synliga blockets
   layoutunderkant (`contentBottom`), mot rutans inre nederkant
   (`innerBottom`), med 1 px tolerans (`stepsWithin`). Ett blocks underkant
   påverkas inte av glyferna. För att varje `.lb-field__body` ska ha ett
   block att mäta ligger ren text i `<div class="lb-text">` (textHTML,
   listHTML med en rad) — ser likadant ut. Bredden mäts som förut med
   `scrollWidth`. Noder som är bortmätta (`display:none`) har ingen låda och
   ryms.
2. **"+1 min"/"Dölj nu" flyttade till sidopanelen**, i "Efter rasten"-delen
   bredvid Rubrik/Visa timer/Minuter ("+1 min" bara med timern på). Rutan på
   tavlan är nu exakt densamma i förhandsvisningen och på elevskärmen, så
   #142:s specialfall i `fitBoard` (knappraden dold under mätningen och den
   extra krympningen av rutan) är borttaget — förhandsvisningen hade
   `--lb-break-scale` 0.89 av knappraden, nu 1.

## Efter

| Yta (efter) | Standardfont | WinSim | Utan ruta |
|---|---|---|---|
| Elevskärm 1920 | scale 1.00, steg 0.99, ruta 1, ruta 404 px, sista steget 1038 av 1037 | scale 1.00, steg 0.98, ruta 1 (405 px), sista steget 1036 | scale 1.00, sista steget 606 |
| Förhandsvisning 1570 | scale 1.00, steg 0.97, ruta 1 (242 px) | scale 1.00, steg 0.96, ruta 1 | scale 1.00, sista steget 362 av 613 |
| Miniatyr | scale 1.00, steg 0.97, ruta 1 (267 px) | scale 1.00, steg 0.97, ruta 1 | — |

Elevskärm 1920 med WinSim också på dpr 1.25 (steg 0.98), dpr 1.5 (0.98) och
zoom 110 % (0.99); 8 steg i stället för 4: steg 0.53–0.54, sista steget
0.05 px från kolumnens nederkant, inget klipps.

Steg-skalan blir **0.97–0.99, inte 1**, med den här planeringen: rutan i
full storlek är 404 px (8.4 em: marginal, ram, rubrikrad med timern 2.52 em,
tre textrader) och Lektionsordning 430 px, i en kolumn på 850 px — kolumnen
är genuint full. Issuens "ruta ca 185 px" var rutan på skalan 0.45.

"+1 min" i panelen: nedräkningen gick från 6:13 till 7:12 i
förhandsvisningen och från 6:20 till 7:10 på elevskärmen (via datalagret).
"Dölj nu": kryssrutan bockas ur, redigeraren döljs, rutan tonas bort i båda
vyerna och Lektionsordning växer tillbaka (sista steget 362 → kolumnen 613).

## Skärmbilder

| Fil | Visar |
|---|---|
| `fore-elev-1910-winsim.png` | Före (main), elevskärm, WinSim: steg 0.45, ruta 0.45 (185 px), halva kolumnen tom |
| `fore-larare-1570-winsim.png` | Före, förhandsvisning: ruta 0.47, stegen på 1 |
| `fore-elev-1910-utan-ruta-winsim.png` | Före, elevskärm utan ruta: referensstorleken (sista steget y ≈ 620) |
| `efter-elev-1920-winsim.png` | Efter, elevskärm, WinSim: steg 0.98, ruta 1, kolumnen full |
| `efter-larare-1570-winsim.png` | Efter, förhandsvisning med "+1 min"/"Dölj nu" i panelen, inga knappar i rutan, miniatyren nere till höger |
| `efter-elev-1920-utan-ruta-winsim.png` | Efter, elevskärm utan ruta: samma `--lb-scale` (1.00), sista steget y = 606 |
