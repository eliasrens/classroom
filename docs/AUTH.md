# Auth — lösenordsväggen

Hela appen ligger bakom en lösenordsvägg (`js/auth.js` +
`js/ui/login.js`): INGET läge, ingen kontrollpanel och ingen
elevskärm renderas förrän läraren är inloggad. `#app` i `index.html`
är `hidden` tills auth säger `signedIn` — det finns inget att "titta
förbi".

## Två driftlägen, samma vägg

| | Lokalt läge (Firebase ej ifylld) | Firebase-läge |
|---|---|---|
| Identitet | Ett lokalt app-lösenord, satt av läraren vid **första start** ("skapa lösenord"), SHA-256-hashat i localStorage | **Firebase Authentication**. Läraren skriver bara **förnamn** (eller initialer) + lösenord; appen lägger på en fast, dold domän (`förnamn@klassrum.local`, se `nameToEmail` i `js/auth.js`) innan `signInWithEmailAndPassword`. |
| Offline | Fungerar alltid | SDK:ns persistens (IndexedDB) håller sessionen; kan SDK:n inte ens laddas släpps en **tidigare inloggad** lärare in via lokal sessionsmarkör. Endast **första** inloggningen på en ny enhet kräver nät — appen låser sig aldrig för en redan inloggad lärare. |
| Konton | Single-user | Konton skapas i Firebase-konsolen (ingen självregistrering). Fler lärare = fler konton; data delas via Firestore. |

Det lokala lösenordet är en vägg mot nyfikna elever vid tangentbordet
— verklig behörighet kommer från Firebase Auth + Firestore-reglerna
(byggs i Läge 5-objektet) så fort molnet kopplas på.

## Elevskärmen

Elevskärmen (`#/elev/…`, eget fönster) **ärver lärarens session**
(samma webbläsare → samma sessionsmarkör/SDK-persistens). Den visar
**aldrig** ett inloggningsformulär och aldrig lärardata: öppnas den
utan session visas en neutral väntevy ("Strax klart…") som
automatiskt släpper in fönstret när läraren loggat in (storage-
event). Utloggning i ett fönster loggar ut alla fönster.

## Flöde

1. `app.js` skapar auth före allt annat; login-vyn renderas i
   `#auth-gate`, appen förblir `hidden`.
2. `signedIn` → gaten töms, appen startar (datalager, router, lägen).
3. `signedOut` efter start → `location.reload()` tillbaka till väggen.
4. I Firebase-läget är `onAuthStateChanged` sanningen när SDK:n är
   laddad; sessionsmarkören i localStorage är bara offline-reserv och
   delning mellan fönster.

## Säkerhetsregler

De skarpa reglerna ligger i **[`firestore.rules`](../firestore.rules)** (rotmappen)
— deploya med `firebase deploy --only firestore:rules`. De kräver
inloggning (`request.auth != null`) för ALL läsning och skrivning, så
elevdata är stängd för oautentiserad åtkomst även om klientkoden ligger
publikt. Åtkomstmodellen (se DATAMODELL.md) i korthet:

```
// DELAT: alla inloggade lärare läser/skriver klasser, elever,
// noteringar, pass och klassinställningar (realtid via onSnapshot).
match /classes/{classId}/{document=**} {
  allow read, write: if request.auth != null;
}

// PRIVAT: lärarprofil + lärarens egna lektionsplaneringar. Bara ägaren.
match /teachers/{uid}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Delad klassdata gör att ett helt arbetslag ser varandras noteringar,
pass och inställningar på samma elever. Lektionsplaneringar är däremot
privata per lärare och ligger under `teachers/{uid}/…` — pathen bär
ägarskapet, så reglerna behöver ingen extra `get()`-läsning. Vid första
inloggning kan lärarprofilen `teachers/{uid}` (DATAMODELL.md) skapas med
`email` och `displayName`. Steg-för-steg-idrifttagning:
[docs/DRIFTSATTNING.md](DRIFTSATTNING.md).
