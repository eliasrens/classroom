# Klassrumsverktyget

Webbaserat klassrumsverktyg för mellanstadiet (åk 4) — morgonskärm,
lektionsplanering, trafikljusur för övergångar, elevlista med noteringar och en
översiktsvy. Ren frontend (HTML5 + CSS + Vanilla JS, **inget byggsteg**), delad
data mellan lärare via Firebase/Firestore med **offline-first**-datalager.

## Köra

Statisk server räcker (ES-moduler kräver http, inte `file://`):

```sh
python3 -m http.server 8000   # → http://localhost:8000
```

Eller lägg repot direkt på GitHub Pages. Ingen bundler, inga beroenden.

## Inloggning

Hela appen ligger bakom en lösenordsvägg — inget renderas före
inloggning. Utan Firebase: läraren väljer ett lokalt app-lösenord vid
första start. Med Firebase: e-post + lösenord via Firebase Auth
(konton skapas i konsolen; en redan inloggad lärare kan fortsätta
offline). Elevskärmen ärver lärarens session och visar aldrig någon
inloggning. Detaljer: [docs/AUTH.md](docs/AUTH.md).

## Firebase (valfritt)

Appen kör helt lokalt (data i webbläsaren) tills `js/firebase-config.js`
fylls i med ett riktigt Firebase-projekt — då synkar datalagret automatiskt
mot Firestore när anslutning finns. Appen kraschar aldrig utan Firebase.

## Arkitektur

```
index.html              app-skal: topbar (lägesmeny, klassval, elevskärm, synkstatus)
css/
  tokens.css            designsystem: tokens; mörk lärarvy (standard) + ljust
                        alternativ + elevtema (projektor)
  base.css, app.css     bas + appskalets komponenter
js/
  app.js                bootstrap — lösenordsvägg först, sedan resten
  auth.js               lösenordsväggen (lokalt lösenord eller Firebase Auth)
  store.js              observerbart globalt tillstånd (klass, läge, vy, synk)
  router.js             hashrouter: #/<läge> (lärare), #/elev/<läge> (elevskärm)
  firebase-config.js    PLATSHÅLLARE — fyll i för molnsynk + Firebase Auth
  data/                 offline-first-datalager (lokalt + Firestore-synk + outbox)
  lib/color.js          ämnespalett + automatisk luminans/kontrast-uträkning
  lib/icons.js          linje-ikoner (inline-SVG) — inga emoji i gränssnittet
  lib/names.js          elevnamn: endast förnamn, valfri tag, initial-läge
  lib/privacy.js        integritet: auto-radering av noteringar + radera all klassdata
  modes/                de fem lägena + registret (Läge 5 = oversikt.js: startvyn)
  ui/login.js           login-vy + elevskärmens väntevy
  ui/class-picker.js    klassval i topbaren
  ui/help.js            genvägslista under "?" · ui/shortcuts.js  globala tangentgenvägar
firestore.rules         Firestore-säkerhetsregler: inloggning krävs för all läs/skriv
docs/
  MODULKONTRAKT.md      kontraktet varje läge implementerar — LÄS FÖRST
  AUTH.md               lösenordsväggen + säkerhetsregler
DATAMODELL.md           Firestore-datastruktur + motivering
```

- **Lägen** byggs parallellt mot [docs/MODULKONTRAKT.md](docs/MODULKONTRAKT.md).
- **Data** läses/skrivs via datalagret med paths ur [DATAMODELL.md](DATAMODELL.md).
- **Elevskärmen** (`#/elev/<läge>`) öppnas i eget fönster och följer lärarens
  klassval och data live (storage-event lokalt, Firestore-lyssnare i molnläge).
