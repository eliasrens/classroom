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
(`firestore.rules`) så fort molnet kopplas på.

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

## Byt lösenord

Inloggad lärare: **Lärare ▾ → Byt lösenord** (`js/ui/change-password.js`,
issue #49). Dialogen har tre fält: **Nuvarande lösenord**, **Nytt
lösenord** och **Upprepa nytt lösenord**
(`autocomplete="current-password"`/`"new-password"`, så att
webbläsarens lösenordshanterare fungerar).

- **Regler** (`js/lib/password-change.js`, testas med
  `node docs/test-password-change.mjs`): det nuvarande måste fyllas i,
  det nya måste ha minst **8 tecken**, båda nya fälten måste stämma
  överens och det nya får inte vara samma som det nuvarande.
- **Firebase-läge:** `reauthenticateWithCredential` med det nuvarande
  lösenordet körs **alltid** först, så att en elev vid en inloggad dator
  inte kan byta det. Därefter körs `updatePassword`. Samma SDK-instans som
  inloggningen används. Felen (fel lösenord, för svagt, offline, för många
  försök, `requires-recent-login`) visas på svenska. Bytet kräver nät.
- **Lokalt läge:** det nuvarande kontrolleras mot hashen och sedan
  ersätts hashen (`classroom:auth:localHash`, samma SHA-256 med salt).
- Läraren förblir inloggad och sessionsmarkören rörs inte, så andra
  fönster, som elevskärmen, påverkas inte. Lösenorden loggas aldrig,
  skickas aldrig på sync-bussen och sparas aldrig i klartext.
- Posten syns bara i lärarvyn. Menyn finns inte på elevskärmen, och
  dialogen är `.teacher-only` och stängs om fönstret växlar till elevvy.

**Glömt lösenord** går inte att återställa via e-post, eftersom adresserna
`@klassrum.local` är fiktiva. Kontot tas då bort och skapas om i
Firebase-konsolen (se [DRIFTSATTNING.md](DRIFTSATTNING.md)).

## Säkerhetsregler

De skarpa reglerna ligger i **[`firestore.rules`](../firestore.rules)** (rotmappen)
— deploya med `firebase deploy --only firestore:rules`. De kräver
inloggning (`request.auth != null`) för ALL läsning och skrivning — och
sedan issue #32 finns det dessutom **ingen elevdata alls i molnet**:
elevlistor, noteringar och Bra jobbat lagras enbart lokalt på varje
lärardator (`js/data/local-only.js`), och reglerna nekar
`classes/{id}/students/**`, `/notes/**`, `/praiseArchive/**` och
`/reports/**` helt.
Åtkomstmodellen (se DATAMODELL.md) i korthet:

```
// DELAT: alla inloggade lärare läser/skriver klasser, pass,
// klassinställningar och ANONYMA noteringsräkningar (noteStats —
// fältvalidering: studentId/text kan aldrig skrivas dit).
// ELEVDATA (students, notes, praiseArchive, reports): nekas helt.

// PRIVAT: lärarprofil + lärarens egna lektionsplaneringar. Bara ägaren.
match /teachers/{uid}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Den delade klasstatistiken gör att ett arbetslag ser varandras pass och
anonyma noteringsräkningar per lektion — men aldrig något om enskilda
elever. Lektionsplaneringar är privata per lärare och ligger under
`teachers/{uid}/…` — pathen bär
ägarskapet, så reglerna behöver ingen extra `get()`-läsning. Vid första
inloggning kan lärarprofilen `teachers/{uid}` (DATAMODELL.md) skapas med
`email` och `displayName`. Steg-för-steg-idrifttagning:
[docs/DRIFTSATTNING.md](DRIFTSATTNING.md).
