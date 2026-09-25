# Testrutin mot riktig Firestore

Gäller alla som testar appen mot det riktiga Firebase-projektet, till exempel
issue-agenter som använder headless Chrome. Lärarnas riktiga klasser (4A, 4B
och andra) delar samma databas som testerna. Ett slarvigt test skriver alltså
i riktig klassdata. Det har hänt: under testet av #29 fick 4A:s
`settings/morningScreen` ett `updatedAt` fyra dagar fram (issue #31).

## Regler

1. **Testa aldrig i en riktig klass.** Skapa en egen testklass med ett namn
   som tydligt är test, till exempel `TEST-31`, och välj den innan du gör
   något annat. Rör aldrig 4A eller 4B, inte ens för att "bara titta" i
   lärarvyn. Lärarvyn skriver själv (veckorytm, auto-radering, slumpad
   bakgrund).
2. **Falsk klocka: stäng sidan INNAN du raderar testdata.** En sida med
   förskjuten `Date` får aldrig vara öppen när testklassen raderas. Ordningen
   är:
   1. Stäng alla sidor med falsk klocka (`close_page`), även förhandsvisningar
      och elevskärmar.
   2. Radera testdata från en sida med riktig klocka, eller via REST.
   3. Verifiera (punkt 4).

   Klassväljaren går numera till "Välj klass…" när den aktiva klassen
   försvinner (#31) och hoppar inte till en annan riktig klass. Stäng ändå
   sidan först: skyddet ska inte vara det enda som står mellan testet och 4A.
3. **Falsk klocka fungerar numera inte som test av "en annan dag".**
   Appen räknar på servertid (`serverNow()`, `js/lib/clock.js`) så snart den
   mätt klockan mot Firestore, och skrivningarna får korrekt tid. Vill du testa
   logik för en annan vecka, anropa de rena funktionerna med en egen
   tidpunkt (`planPraiseRollover(doc, cid, now)`, `weekKey(ts)` …) i
   Node, i stil med `docs/test-clock.mjs`.
4. **Efteråt: verifiera att riktiga klasser är orörda.** Via REST:
   ```sh
   # ID-token för testkontot (lösenordet får du av Lead, skriv det ALDRIG i
   # kod, commits, PR eller issues). Läs det till en variabel utan eko:
   read -rs PW
   TOKEN=$(curl -s "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$API_KEY" \
     -H 'Content-Type: application/json' \
     -d "{\"email\":\"elias@klassrum.local\",\"password\":\"$PW\",\"returnSecureToken\":true}" | jq -r .idToken)
   BASE="https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents"
   curl -s -H "Authorization: Bearer $TOKEN" "$BASE/classes" | jq '.documents[].name'
   ```
   Kontrollera att testklassen och dess subkollektioner är borta. Kontrollera
   också att inget dokument under `classes/{4A,4B}/…` har `updatedAt` i
   framtiden eller ändrades under testet.
   (`$API_KEY` och `$PROJECT` finns i `js/firebase-config.js`.)
5. **Radera testklasser via REST, med alla sidor stängda.** Stäng först
   varje Chrome-sida (lärarvy, elevskärm, förhandsvisning) och radera sedan
   testklassen och dess subkollektioner via REST (se punkt 4 för token och
   `$BASE`), aldrig med "Radera all data" i en öppen lärarvy mitt i ett
   test. En öppen sida kan skriva tillbaka data i klassen (veckorytm,
   autosparning) eller, i äldre versioner, byta till en annan riktig klass.
   Efter "Radera all data" i appen är ingen klass vald ("Välj klass…"),
   men det skyddet ska inte vara det enda som står mellan testet och 4A.
   Klassåtgärder (`classActions`, `classActionReplies`, issue #34) får bara
   tas bort av den lärare som skrev dem — utom när klassdokumentet redan är
   borta. Radera därför **klassdokumentet först** och sedan subkollektionerna
   (`classActions`, `classActionReplies`, `noteStats`, `sessions`,
   `settings`), så räcker ett konto för att städa allt.
6. **Resurssnålt.** Maskinen har ungefär 8 GB RAM. Kör en webbserver och så få
   Chrome-sidor som möjligt, och stäng allt efteråt.
