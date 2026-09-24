# Idrifttagning — koppla på Firebase (skarpt läge)

Appen kör helt lokalt tills `js/firebase-config.js` fylls i. Den här
guiden tar dig från platshållare till skarp drift: molnlagring i
Firestore och realtidsdelning mellan flera lärare. Du behöver ett
Google-konto och ca 15 minuter. Ingenting i den vanliga användningen
kräver kommandoraden — bara reglerna deployas via `firebase`-CLI:t.

> Kort version: skapa Firebase-projekt → klistra in SDK-configen i
> `js/firebase-config.js` → aktivera Authentication (e-post/lösenord) →
> skapa ett konto per lärare → deploya `firestore.rules`. Klart.

---

## 1. Skapa ett Firebase-projekt

1. Gå till <https://console.firebase.google.com/> och **Lägg till projekt**.
2. Namnge det (t.ex. `klass-4a-verktyg`). Google Analytics kan stängas av.
3. I projektet: **Skapa databas** under **Firestore Database**.
   - Välj region nära dig (t.ex. `europe-west1`).
   - Starta i **produktionsläge** (låst) — vi lägger in våra egna
     regler i steg 5. (Startläget spelar ingen roll, reglerna ersätts.)

## 2. Hämta och klistra in SDK-konfigurationen

1. I konsolen: **Projektinställningar** (kugghjulet) → **Allmänt** →
   längst ned under **Dina appar**, välj **Webb** (`</>`).
2. Registrera appen (valfritt smeknamn, du behöver INTE Firebase Hosting).
3. Kopiera `firebaseConfig`-objektet som visas.
4. Öppna **`js/firebase-config.js`** och ersätt platshållarvärdena med
   dina — behåll fält­namnen exakt:

   ```js
   export const firebaseConfig = {
     apiKey: "AIzaSy…",                    // din nyckel
     authDomain: "klass-4a-verktyg.firebaseapp.com",
     projectId: "klass-4a-verktyg",
     storageBucket: "klass-4a-verktyg.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123…",
   };
   ```

Så fort `apiKey` inte längre börjar med `FYLL_I` slår appen om till
skarpt läge automatiskt (`isFirebaseConfigured()` i samma fil). Ingen
annan kodändring behövs — datalagret börjar läsa/skriva mot Firestore
och lägger upp `onSnapshot`-lyssnare för realtid.

> **Är `apiKey` en hemlighet?** Nej. En Firebase-webbnyckel är publik
> per design — den identifierar bara projektet. Det som skyddar datan
> är säkerhetsreglerna (steg 5), inte nyckeln. Därför är det ofarligt
> att checka in `js/firebase-config.js`.

## 3. Aktivera inloggning (Firebase Authentication)

1. Konsolen → **Authentication** → **Kom igång**.
2. Under **Sign-in method**, aktivera **E-post/lösenord**.
   (Lämna "E-postlänk/lösenordslös" av — appen använder lösenord.)

## 4. Bjuda in fler lärare — skapa konton

Det finns ingen självregistrering (medvetet — inga elever ska kunna
skapa konton). Lärarna loggar in med **bara sitt förnamn** (eller
initialer) + lösenord — ingen e-postadress. Firebase Auth kräver dock
e-post bakom kulisserna, så appen lägger automatiskt på en **fast, dold
domän `@klassrum.local`**: läraren skriver `elias`, appen loggar in som
`elias@klassrum.local`. Domänen syns aldrig i gränssnittet.

Du skapar därför kontona med samma mönster i konsolen:

1. **Authentication** → fliken **Users** → **Lägg till användare**.
2. I **E-post**-fältet: skriv `förnamn@klassrum.local`, t.ex.
   `elias@klassrum.local` (gemener, inga mellanslag). Sätt ett
   **startlösenord**, spara.
3. Ge läraren bara **förnamnet** (`elias`) och lösenordet — inte
   domänen. Vid första inloggningen på en ny enhet krävs nät; därefter
   fungerar appen även offline för den läraren.

> Krockar två lärare på förnamn (två "Anna"): använd t.ex.
> `anna` och `annab` (eller initialer) — det läraren skriver måste
> matcha delen före `@klassrum.local` i kontot.

Alla inloggade lärare delar samma klasser, pass, anonyma noterings­-
räkningar och klassinställningar och ser varandras ändringar i realtid.
**Elevdata (elevlistor, noteringar, Bra jobbat) finns bara lokalt på
varje lärardator** och delas aldrig (issue #32, se docs/DATASKYDD.md).
**Lektionsplaneringar är privata** per lärare — var och en ser bara
sina egna.

> Vill en lärare byta lösenord: gör det i **Authentication → Users**
> (tre prickar → återställ lösenord).

## 5. Deploya säkerhetsreglerna

Reglerna i **`firestore.rules`** kräver inloggning för ALL läsning och
skrivning. **Utan dem ligger elevdata öppet** eftersom klientkoden är
publik — så det här steget är obligatoriskt, inte valfritt.

Engångsinstallation av CLI:t (kräver Node.js):

```sh
npm install -g firebase-tools
firebase login                       # öppnar webbläsaren, logga in med Google
```

Peka på ditt projekt och deploya (kör i repo-roten, där `firebase.json`
och `firestore.rules` ligger):

```sh
firebase use --add                   # välj ditt projectId, ge det aliaset "default"
firebase deploy --only firestore:rules
```

`firebase use --add` skapar en lokal `.firebaserc` med ditt projekt-id.
Den filen är projektspecifik och behöver inte checkas in.

**Verifiera** i konsolen → **Firestore Database** → **Rules** att
innehållet matchar `firestore.rules`. Testa gärna i **Rules Playground**
att en oautentiserad läsning av `classes/…` nekas.

Kör reglerna om varje gång `firestore.rules` ändras (t.ex. om
datamodellen växer).

---

## Verifiera skarp drift

- **Synk:** logga in, lägg till en elev eller notering. Synkstatusen i
  topbaren ska visa **"Synkad"**. I konsolen dyker dokumenten upp under
  `classes/{klassId}/…`.
- **Realtid mellan lärare:** logga in som två olika lärare i två
  webbläsare (eller ett inkognitofönster). En ny notering, elev, sparat
  pass eller ändrad inställning hos den ena ska synas hos den andra
  inom ett ögonblick, utan omladdning. Ta bort en notering — den
  försvinner hos båda.
- **Privata planeringar:** lektionsplaneringar syns bara för den lärare
  som skapat dem. Kontrollera i konsolen att de ligger under
  `teachers/{uid}/classes/{klassId}/lessonPlans`, inte under `classes/`.
- **Offline:** stäng av nätet. Appen fortsätter fungera (lokal cache);
  status visar **"Offline — synkar senare"**. Slå på nätet igen — köade
  ändringar skickas upp och de andra lärarna ser dem. En lärare utan
  nät blockerar aldrig de andra.

## Övergång platshållare → skarpt "bara fungerar"

Datalagret är offline-first: localStorage är alltid sanningskälla,
Firestore är asynkron synk ovanpå. Att fylla i `firebase-config.js` är
därför riskfritt — data som redan finns lokalt hos en lärare skickas
upp vid nästa anslutning. Vill du börja helt rent i molnet, gör det
innan lärarna hunnit lägga in lokal data.

## Vanliga fel

| Symptom | Trolig orsak |
|---|---|
| Status fastnar på "Offline" fast nätet funkar | Reglerna inte deployade, eller inte inloggad → Firestore nekar (`permission-denied`). Kontrollera steg 3–5. |
| "Missing or insufficient permissions" i konsolloggen | Säkerhetsreglerna saknas/är fel deployade. Kör om steg 5. |
| Inloggning misslyckas för en lärare | Kontot saknas i Authentication (steg 4), fel förnamn/lösenord, eller kontots e-post skapades utan `@klassrum.local`. Förnamnet läraren skriver måste matcha delen före `@klassrum.local`. |
| Data syns lokalt men inte i konsolen | `apiKey` börjar fortfarande med `FYLL_I`, eller SDK:n blockeras (t.ex. nätverksbrandvägg mot `gstatic.com`). |

## Elevskärm på projektorn (auto-helskärm)

När du trycker **"Öppna elevskärm"** försöker appen lägga elevfönstret
på **skärm 2 (projektorn)** och gå direkt i **helskärm** där — utan att du
behöver dra fönstret manuellt.

Det kräver:

- **Chrome eller Edge** (använder Window Management API — saknas i
  Firefox/Safari).
- **https** (eller `localhost`) — säker kontext krävs.
- Ett **engångsgodkännande**: första gången frågar webbläsaren om appen
  får "hantera fönster på alla dina skärmar". Godkänn så minns den valet.

Uppfylls något av detta inte — annan webbläsare, http, behörigheten nekad,
eller bara **en skärm** — händer inget fel: elevfönstret öppnas som vanligt
och du växlar helskärm manuellt med **dubbelklick** i elevfönstret (eller
knappen **"Helskärm här"** i lärarvyns elevskärmspanel). Allt är
best-effort och inkapslat — funktionen faller alltid tillbaka rent.

---

Se även [AUTH.md](AUTH.md) (lösenordsväggen) och
[../DATAMODELL.md](../DATAMODELL.md) (datastruktur + delat/privat).
