# Issue #142: Lektionsordning krymper olika i förhandsvisningen och på elevskärmen

Lokalt läge (Firebase-konfigurationen ersatt med platshållaren av en lokal
testserver, inget moln) med den påhittade klassen `TEST-142`. Planeringen har
Vad, Hur, Varför, Lektionsordning med 4 korta steg och "Efter rasten" med
"Välj mellan: – Läsa – Rita" (3 rader), starttid 23:30 så timern står still
på 10:00. Lägena: (a) utan bottenrad med timer, (b) utan bottenrad utan
timer, (c) med Du behöver och timer, (d) med Du behöver utan timer.
Elevskärmen 1280×720 och 1920×1080; lärarvyn i ett 1280 px brett fönster
(tavlan 805 px, font 22.7 px) och ett 1920 px brett (tavlan 1445 px,
font 41 px). "Före" är `main` (`0fc11e3`).

## Grundorsak

Rutans utseende är detsamma i båda vyerna och allt i den är i em — men i
lärarens förhandsvisning har rutan dessutom knappraden "+1 min"/"Dölj nu"
(`.lb-break__tools`, teacher-only), 0.75 em hög plus 0.15 em mellanrum.
Rutan är alltså ~0.9 em högre i förhandsvisningen än på elevskärmen, i en
mittenkolumn på 13.3 em (med bottenrad) eller 16.4 em (utan). `fitBoard()`
mätte den högre rutan och krympte därför Lektionsordning (eller rutan, i
reservfallet) mer i förhandsvisningen än på elevskärmen:

| Läge, 1280 | Före: förhandsvisning | Före: elevskärm |
|---|---|---|
| (a) utan bottenrad, timer | steg **0.79**, ruta 1 | steg **0.94**, ruta 1 |
| (c) Du behöver, timer | steg 0.46, ruta **0.89** | steg 0.47, ruta 1 |
| (d) Du behöver, utan timer | steg 0.55, ruta 1 (1920-fönster) | steg 0.67, ruta 1 |

Rutans andel av kolumnen (höjd/kolumnhöjd) var 0.554 i förhandsvisningen
mot 0.486 på elevskärmen i (d).

Inget annat skiljer: tavlans font-size är 2.85 cqi i båda vyerna (clampen
9–60 px slår inte i vid 805–1849 px breda tavlor), `--lb-scale` är lika
(0.99/1.00), kolumnhöjden i em skiljer bara ~0.1 em (de tunna px-linjerna:
tavlans ram 3 px, kolumnlinjerna 2 px, rutans ram 3 px). Elevvyns
`.lb-fit` begränsas av höjden och typografin följer dess bredd, så
proportionerna är desamma på 1280 och 1920.

## Rättning

`fitBoard()` steg 2 (js/modes/lektion.js): knappraden döljs under
mätningen, så `fitMidColumn` ger förhandsvisningen exakt elevskärmens
skalor för Lektionsordning och rutan. Sedan visas raden igen och får plats
genom att bara rutans egen text krymps (`--lb-break-scale`, samma mekanism
som reservfallet, binärsökning från den skala som redan satts) — aldrig
Lektionsordning, och inget klipps. Elevskärmen (ingen knapprad) påverkas
inte alls. Rutans utseende (timer, knappar, padding, ram) är oförändrat.

Logiken i js/lib/board-fit.js är oförändrad, så inga nya testfall; alla
`docs/test-*.mjs` är gröna.

## Efter

| Läge | Förhandsvisning 1280 | Elevskärm 1280 | Förhandsvisning 1920 | Elevskärm 1920 |
|---|---|---|---|---|
| (a) utan bottenrad, timer | steg **0.91**, ruta 0.90, andel 0.498 | steg **0.94**, ruta 1, andel 0.486 | steg 0.95, ruta 0.90, andel 0.487 | steg 0.96, ruta 1, andel 0.481 |
| (b) utan bottenrad, utan timer | steg 1.00, ruta 0.99 | steg 1.00, ruta 1 | steg 1.00, ruta 1 | steg 1.00, ruta 1 |
| (c) Du behöver, timer | steg 0.45, ruta 0.89, andel 0.615 | steg 0.47, ruta 1, andel 0.602 | steg 0.48, ruta 0.90, andel 0.603 | steg 0.48, ruta 1, andel 0.595 |
| (d) Du behöver, utan timer | steg 0.66, ruta 0.87, andel 0.499 | steg 0.67, ruta 1, andel 0.486 | — | — |

Skillnaden på 0.01–0.03 i stegskala vid 1280 är px-linjerna (kolumnen
13.16 em i förhandsvisningen mot 13.27 em på elevskärmen); vid 1920 är
skalorna identiska. Lektionsordning slutar vid kolumnens nederkant i alla
lägen (sista stegets luft = fältets padding 0.45 em med bottenrad, 0 utan).

## Rutan tar verkligen plats — inte en bugg

Med bottenraden är mittenkolumnen 13.3 em hög. Lektionsordning med 4 korta
steg vid skala 1 är 8.8 em (rubrik 1 em + 4 × 1.38 em + 3 × 0.35 em + fältets
luft 0.9 em). Rutan med 3 rader och timer är 8.0 em (marginal 0.6, ram,
padding 0.75, rubrikrad med timern 2.52 em, text 3 × 1.38 em + listmellanrum,
knappraden oräknad). 8.8 + 8.0 = 16.8 em > 13.3 em, så Lektionsordning
måste krympa till ~0.47 — i båda vyerna. Utan bottenraden (16.4 em) räcker
det nästan (0.94–0.96). Utan timer är rubrikraden 0.9 em i stället för
2.52 em, därav 0.67 i (d). Tumregel från mätningarna: med bottenrad ryms
skala 1 när 1.73 · antal steg + 1.38 · antal rader i rutan ≤ 7.5 (t.ex.
3 steg + 1 rad); utan bottenrad ≤ 10.6 (4 steg + 2 rader). Vill läraren ha
Lektionsordning i full storlek med både bottenrad och ruta är det ett
designbeslut (mindre timer, tätare ruta eller färre rader), inte en bugg.

## Skärmbilder

| Fil | Visar |
|---|---|
| `fore-larare-1280-c.png` / `fore-elev-1280-c.png` | Före, läge (c): förhandsvisning (steg 0.46, ruta 0.89) och elevskärm 1280×720 (steg 0.47, ruta 1) |
| `fore-larare-1280-d.png` | Före, läge (d), förhandsvisning i 1920-fönster: steg 0.55 (elevskärmen 0.67) |
| `efter-larare-1280-a.png` / `efter-elev-1280-a.png` | Efter, läge (a): steg 0.91 resp. 0.94 (före 0.79 resp. 0.94) |
| `efter-larare-1280-c.png` / `efter-elev-1280-c.png` | Efter, läge (c): steg 0.45 resp. 0.47 — rutan ser ut exakt som före |
| `efter-larare-1280-d.png` / `efter-elev-1280-d.png` | Efter, läge (d): steg 0.66 resp. 0.67 |
| `efter-larare-1920-c.png` / `efter-elev-1920-c.png` | Efter, läge (c) i 1920: steg 0.48 i båda |
