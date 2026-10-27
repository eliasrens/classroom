# Issue #138: Lektionsordning utan bottenrad

Lokalt läge (Firebase-konfigurationen ersatt med platshållaren av en lokal
testserver, inget moln) med den påhittade klassen `TEST-138`. Planeringen har
Vad, Hur, Varför, När du är klar, Lektionsordning och "Efter rasten" med två
punkter (starttid 23:30, så timern står still på 10:00). Du behöver och Mål
är avbockade. "Före" är `main` (`ebe67ab`).

| Fil | Visar |
|---|---|
| `fore-elev-1920-utan-bottenrad.png` | Före: 4 korta steg, `--lb-steps-scale` 0.708, sista steget slutar 26 px ovanför ramen (fältets luft) |
| `efter-elev-1920-utan-bottenrad.png` | Efter: samma planering, `--lb-steps-scale` 0.777, sista steget slutar vid ramen |
| `efter-larare-1280-manga-steg.png` | Efter: lärarvyn 1280, 8 steg, `--lb-steps-scale` 0.682, rubrik och steg krymper lika mycket |

## Mätt i webbläsaren

- Utan bottenrad går mittenkolumnen redan ända ner till ramen: kolumnens
  underkant = tavlans inre nederkant (1056.98 px på elevskärmen 1920,
  509.81 px i lärarvyn 1280). Ingen kvarbliven `min-height` eller tom yta.
- Det som tvingade Lektionsordning att krympa i onödan var fältets egen luft
  under sista steget (`padding-bottom`, 24 px på 1920). Nu mäts sista
  stegets underkant mot kolumnens nederkant (`stepsWithin`,
  js/lib/board-fit.js), och luften tas bort när rutan står i kolumnen utan
  bottenrad.
- Krympningen i övrigt är verklig: tavlans `--lb-scale` räknas utan rutan och
  blir ofta 1 utan bottenraden. Vid steg-skala 1 är rutan 492 px och
  Lektionsordning 607 px i en kolumn på 870 px, så sista steget skulle sluta
  121 px under ramen. Med 4 korta steg blir det därför 0.777, inte 1.
- 3 korta steg: 0.863. Över 0.87 radbryts steg 2 och når 9 px förbi ramen,
  därav glappet på 44 px.
- Med bottenraden på: oförändrat (samma planering: `--lb-scale` 0.905,
  steg 0.450, ruta 0.785, före och efter).
