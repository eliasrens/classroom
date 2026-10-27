# Issue #134: "Efter rasten" krymper bara Lektionsordning

Lokalt läge (Firebase-konfigurationen ersatt med platshållaren av den lokala
testservern, inget moln) med den påhittade klassen `TEST-134`. Planeringen
har alla fält ikryssade, åtta steg i Lektionsordning och starttiden 23:30, så
rutan står still på 10:00. "Före" är `main` (`92e0552`), "efter" är den här
grenen.

| Fil | Visar |
|---|---|
| `fore-larare-1280-ruta.png` | Före: rutan krymper HELA tavlan (`--lb-scale` 0.502) |
| `efter-larare-1280-ruta.png` | Efter: tavlan står på 0.630 (samma som utan rutan), bara Lektionsordning är mindre (`--lb-steps-scale` 0.785) |
| `efter-elev-1920-ruta.png` | Elevskärmen 1920×1080, samma skalor |
| `efter-elev-1920-efter-dolj-nu.png` | Elevskärmen efter "Dölj nu" i lärarvyn: Lektionsordning tillbaka på full storlek, inget annat har flyttat |
| `efter-larare-1280-reserv-lang-ruta.png` | Reservfallet: 13 rader i rutan. Lektionsordning på golvet 0.45, rutan krymps till 0.596. `--lb-scale` är fortfarande 0.630 |

## Mätt i webbläsaren

`getBoundingClientRect()` och `font-size` för vänsterkolumnen, Vad,
högerkolumnen, När du är klar, rubrikraden, raden Du behöver/Mål och Mål,
före och 1.2 s efter "Dölj nu":

- **Lärarvy 1280×720:** alla identiska. `--lb-scale` 0.630 före, under
  toningen (stickprov var 100 ms) och efter. `--lb-steps-scale` 0.785 under
  hela toningen och 1 när rutan tagits bort.
- **Elevskärm 1920×1080:** alla identiska, `--lb-scale` 0.630 hela tiden.
  Lektionsordnings text gick från 28.1 px till 35.9 px.
- **Med Bra jobbat (70 namn):** `--lb-scale` 0.630 med rutan, samma värde
  som efter "Dölj nu" ovan. Namnrutan lägger ut sig i tre kolumner och
  krymper sin egen text, så den tvingade inte fram någon extra sökning här.
