# Issue #132: "Lektionsordning" + "Efter rasten" med nedräkning

Lokalt läge med den påhittade testklassen `TEST-132`. Ingen riktig klass och
inget moln är inblandat. Planeringen "Bråk intro" (Matematik) har alla fält
ikryssade och starttiden 20:00, så rutan visar full tid (10:00) och står
still före start. "Före" är `main` (`3ae11f8`), "efter" är den här grenen.

Filnamn: `{fore|efter}-{larare|elev}-{morkt|ljust}-{1920|1280}-{innehåll}.png`

| Fil | Visar |
|---|---|
| `fore-larare-morkt-1280`, `fore-larare-ljust-1920` | Före: mittenkolumnen heter "ATT GÖRA", ingen Efter rasten-ruta |
| `efter-larare-morkt-1280-valj-mellan`, `efter-larare-morkt-1920-valj-mellan`, `efter-larare-ljust-1920-valj-mellan` | Rutan med "Välj mellan:" + två punkter, timern uppe till höger, "+1 min"/"Dölj nu" nederst till höger. Panelen: kryssrutan "Efter rasten" med Minuter, textfält och hinten |
| `efter-larare-ljust-1280-punkter` | Rutan med enbart punkter |
| `efter-elev-1920-punkter`, `efter-elev-1280-valj-mellan` | Elevskärmen: samma ruta utan lärarknappar |
| `efter-elev-1280-efter-dolj-nu` | Elevskärmen efter "Dölj nu" i lärarvyn: rutan borta, Lektionsordning överst, texten anpassad uppåt igen |

Elevskärmen före ändringen är samma tavla som lärarens förhandsvisning (bara
etiketten "ATT GÖRA" skiljer), så den har ingen egen före-bild.

## Mätt i webbläsaren (1280×720)

`getBoundingClientRect()` före och efter "Dölj nu":

- **Lärarvy:** tavlan `440,60,805×452.8` före och efter. Vänster-, mitten-
  och högerkolumnen behåller x och bredd (200.8 / 359.8 / 238.5). `--lb-scale`
  stod på 0.837 under hela toningen och blev 0.957 cirka 0.5 s efter klicket.
  Det är samma värde som en ny ritning av planeringen utan rutan ger (0.957).
- **Elevskärm:** tavlan `1208.9×680` före och efter, och kolumnbredderna är
  oförändrade (301.7 / 541.5 / 359.7). Skalan stod på 0.888 under toningen och
  blev sedan 0.966, samma som utan rutan.
- Det enda som flyttar lodrätt är rubrikbandet och raden "Du behöver"/"Mål".
  De följer textanpassningen när texten växer igen, och det är tillåtet.
- **Bortoning när tiden är ute:** en planering med 2 min. Timern stod på 2:00
  före starttiden och räknade sedan ned. Vid 0:00 tonades rutan bort i båda
  vyerna, kryssrutan bockades ur i lärarvyn och skalan gick från 0.802 till
  0.957.
