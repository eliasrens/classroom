# QA 3: Lärarsidor — Elevlista, Översikt, Mina ämnen, Byt lösenord (issue #94)

Testad 2026-09-27 i lokalt läge: en kopia av appen serverades med
Firebase-apiKey överstyrd till "FYLL_I…" (den spårade
`js/firebase-config.js` är orörd). Testklasserna **QA-TEST-94** (10 fiktiva
elever) och **QA-TEST-94B** (raderades i testet) användes. Ingen riktig klass
(4A–4D) och inget riktigt lärarkonto har öppnats eller ändrats.

## Vad som testades

**Skärmstorlekar:** 1920×1080, 1366×768 och 1280×720.
**Tema:** mörkt (standard) och ljust. **Konsolen:** inga fel eller varningar
under hela genomgången.

**Elevlista** (`js/modes/elever.js`, `js/modes/elever/*`):

- Elever: inklistrad lista med tio namn, där "Hugo Svensson" sparas som
  "Hugo" (endast förnamn), samt Ändra, Arkivera och tilldelning av tangent. ✔
- Registrera: klick på elev ger en notering av standardtypen, byte av
  standardtyp ("Ur stol"), + ger en positiv notering, tangent ger en
  notering och Shift+tangent en positiv, Ctrl+Z och "Ångra senaste" tar bort
  den senaste, minneslistan grupperas per elev, och "Nollställ inför nästa
  lektion" tömmer listan men behåller noteringarna. ✔ En bugg rättad
  (hållen tangent), se nedan.
- Elevkort & sök: elevväljare, uttag för period och byte av elev. ✔ En bugg
  rättad (uttaget stod kvar på fel elev), se nedan.
- Mönster: fördelning per moment, veckodag, tid och ämne. Perioden kan
  väljas. ✔
- Rapporter:
  - Krypterad export: för kort lösenord och olika lösenord stoppas med
    tydliga meddelanden, och knappen är inaktiv tills lösenordet duger.
    Filen (PBKDF2 600 000 varv, AES-GCM 256) innehåller **inga elevnamn eller
    noteringstyper i klartext**. Det enda som står i klartext i huvudet är
    klass- och lärarnamnet. ✔
  - Öppna fil: fel lösenord ger "Fel lösenord — eller så är filen skadad"
    och rätt lösenord visar matchningstabellen (förslaget "Samma namn" och
    "Håll isär"). Inget slås ihop förrän matchningen bekräftats. ✔
  - Sammanslagning av egna noteringar och den egna filen dubbelräknar inte
    (8 noteringar, inte 16). ✔
  - Utskrift/PDF: varningsrad om att utskriften är okrypterad, och Esc
    stänger vyn. ✔ En bugg rättad (genvägar bakom dialogen), se nedan.
  - **Nätverket:** under hela flödet (registrering, export, öppning,
    sammanslagning och utskrift) gick bara statiska appfiler och en
    Unsplash-bakgrund till elevskärmens förhandsvisning över nätet, alltså
    **inga elevdata**. Molnvägen i inloggat läge täcks av
    `docs/test-privacy.mjs` (grön).

**Översikt** (`js/modes/oversikt*.js`):

- Idag / denna vecka: veckosiffror, senaste klassåtgärder med svar och
  lägesrutorna. ✔
- Veckor / arkiv: veckosammanställning, trafikljuskort och antal
  klassåtgärder. ✔
- Klassåtgärder:
  - Namnspärren stoppar texten "Vi lät Celia sitta vid fönstret…" med
    meddelandet "Hittade ett elevnamn: Celia". En text utan namn delas. ✔
  - Som en annan lärare (sessionen bytt) syns bara "Testade också" på
    kollegans åtgärd, inte Ändra eller Ta bort. Svaret sparas och visas
    under åtgärden. ✔
- Inställningar och dataskydd:
  - Lagringstiden är 20 veckor som standard.
  - En pausad gallring (seedad med `awaitingChoice`) visar rutan "Gallringen
    är pausad" och "Bekräfta 20 veckor…" häver pausen.
  - Radera all data i **QA-TEST-94B**: Avbryt och fel namn raderar
    ingenting ("Namnet stämde inte — inget raderades."). Rätt namn raderar
    bara den klassen och lämnar klassväljaren på "Välj klass…". QA-TEST-94
    var orörd. ✔

**Mina ämnen** (`js/ui/my-subjects-dialog.js`): dialogen med grupperna
SO-ämnen och NO-ämnen, "Alla SO" och "Alla NO" (kryssar i och ur hela
gruppen), antal valda, att inget ikryssat betyder "Inget val — alla ämnen
visas", och sammanfattningen i Inställningar ("5 valda: Matematik, NO, …"). ✔
En bugg rättad (egna ämnen från en annan klass försvann), se nedan.
Filtreringen i ämnesväljaren och "Lägg till i mina ämnen" i
lektionsplaneringen testades i QA 1 (#93, `docs/qa/rutiner.md`) och täcks
av `docs/test-my-subjects.mjs`.

**Byt lösenord** (Lärare ▾ → Byt lösenord, lokalt läge):

- Tomt nuvarande lösenord: "Skriv ditt nuvarande lösenord."
- Kortare än 8 tecken: "…måste vara minst 8 tecken."
- Olika nya lösenord: "De två nya lösenorden stämmer inte överens."
- Samma som det nuvarande: "…får inte vara samma som det nuvarande."
- Fel nuvarande lösenord: "Fel nuvarande lösenord."
- Rätt: "Lösenordet är bytt." Rätt fält markeras med `aria-invalid` vid
  varje fel.
- Efter utloggning avvisas det gamla lösenordet ("Fel lösenord.") och det
  nya fungerar. ✔
- **Firebase-flödet testades inte** (beslut från epic-ledaren). Det kräver
  ett tillfälligt testkonto som skapas och raderas (#49). Felkodsöversättningen
  för Firebase täcks av `docs/test-password-change.mjs` (grön).

**Gemensamt:** den enhetliga sidramen och flikraden (#61) är lika i
Elevlista och Översikt. Ingen horisontell scroll vid 1280. Mörkt och ljust
tema. Esc stänger alla dialoger. Översiktsbilder finns i
`docs/screenshots/issue-94/`: `elever-registrera-{ljust,morkt}-1366.png`,
`rapporter-morkt-1280.png`, `rapporter-matchningstabell.png`,
`rapport-utskrift.png`, `oversikt-idag-ljust-1920.png`,
`oversikt-veckor-morkt-1920.png` och `byt-losenord-klart.png`.

**Testsviter:** alla 16 `docs/test-*.mjs` är gröna efter ändringarna
(589 + 39 + 25 + 1988 + 1996 + 20 + 28 + 70 + 179 + 44 + 29 + 24 kontroller,
och test-clock/nav/outbox/present "ALLA OK"). `node --check` passerar på
de ändrade filerna.

## Rättade buggar

### 1. En hållen elevtangent sprutade in noteringar

**Vad:** I Registrera ger en elevs tangent en notering. Höll läraren inne
tangenten lite för länge skapade tangentbordets upprepning en ny notering
per repetition. Sex tangenthändelser (en nedtryckning och fem upprepningar)
blev sex "Prat" på samma elev.

**Rättning:** `js/modes/elever.js`: `if (e.repeat) return;` innan tangenten
matchas mot eleverna. En nedtryckning ger nu en notering.

**Före:** `docs/screenshots/issue-94/registrera-hallen-tangent-fore.png`
(Bo har 7 × Prat efter ett tryck och upprepningar).
**Efter:** `docs/screenshots/issue-94/registrera-hallen-tangent-efter.png`
(en notering).

### 2. Elevkortets uttag stod kvar när man bytte elev

**Vad:** Läraren tryckte på "Visa uttag" för Alva och klickade sedan på Bo
i listan. Uttagsrutan med **Alvas** noteringar ("Uttag: Alva — …") stod då
kvar under rubriken "Bo B" och kunde kopieras som om den gällde Bo. Samma
gällde ett öppet insatsformulär och en pågående radredigering.

**Rättning:** `js/modes/elever/card.js`: byte av elev nollställer
`_cardExport`, `_cardInsats` och `_cardEditingNote`.

**Före:** `docs/screenshots/issue-94/elevkort-uttag-fel-elev-fore.png`
**Efter:** `docs/screenshots/issue-94/elevkort-uttag-fel-elev-efter.png`

### 3. Sifferkortkommandon bytte läge bakom rapportdialogerna

**Vad:** Lösenordsdialogen för rapporter var öppen och fokus låg på en
knapp, t.ex. Avbryt. Då bytte "2" läge till Lektion (dialogen försvann utan
att något sparades) och "E" öppnade elevskärmen. Det gällde också
utskriftsvyn och Byt lösenord. Den globala spärren kände bara till
snabbanteckningen, hjälpen och klassåtgärdsdialogen.

**Rättning:** `js/ui/shortcuts.js`: `dialogOpen()` räknar också med
`.ms-modal`, `.rap-modal`, `.pwchange` och `.rp-print`.

**Före:** `docs/screenshots/issue-94/rapport-dialog-genvag-fore.png`
(efter "2" syns Lektion och dialogen är borta).
**Efter:** `docs/screenshots/issue-94/rapport-dialog-genvag-efter.png`
(dialogen ligger kvar efter "2", "e" och "1").

### 4. Mina ämnen tappade egna ämnen från andra klasser

**Vad:** Mina ämnen sparas per lärare, men egna ämnen hör till en klass.
Om dialogen öppnades och sparades i en klass som saknade lärarens egna ämne
från en annan klass (här "Schack" i QA-TEST-94B) försvann det ämnet ur valet,
även om läraren inte ändrade något. Tillbaka i klass B stod det "5 valda"
i stället för "6 valda: …, Schack".

**Rättning:** `js/ui/my-subjects-dialog.js`: id:n som saknar kryssruta i
dialogen behålls när läraren sparar. Inget ikryssat betyder fortfarande
"inget val", och då sparas en tom lista precis som tidigare.

**Före:** `docs/screenshots/issue-94/mina-amnen-annan-klass-fore.png`
("5 valda" i QA-TEST-94B).
**Efter:** `docs/screenshots/issue-94/mina-amnen-annan-klass-efter.png`
("6 valda: …, Schack").

## Fynd som inte är rättade

| Allvar | Typ | Beskrivning | Förslag | Insats |
|---|---|---|---|---|
| Medel | Kod | Samma fyndklass som i QA 5 (#96, `docs/qa/kod.md`): värden från delade molndokument hamnar oescapade i HTML-attribut. Utöver färgerna som #96 listar gäller det även `data-phase="${p.result.color}"` i `js/modes/oversikt/veckor.js:286,397`. Det kräver en manipulerad Firestore-skrivning, och appens eget UI kan inte skapa sådana värden. | Åtgärda tillsammans med #96-förslaget (en delad `safeColor()`/vitlista) så att alla sänkor rättas på en gång. | liten |
| Låg | UX | Första lokala lösenordet kräver minst 4 tecken (`js/auth.js:121`), men Byt lösenord kräver minst 8. En lärare med ett kort lokalt lösenord kan inte "byta" till ett lika kort. | Använd samma gräns i båda fallen (8). | liten |
| Låg | UX | I lokalt läge saknas lärarnamn, så egna noteringar och klassåtgärder visas som "okänd lärare". I inloggat läge finns namnet. | Visa "du" eller "Lärare" för egna poster i lokalt läge. | liten |
| Låg | UX | Vid 1920 bryts "Lektionsplanering" mitt i ordet i lägesrutan på Översikt › Idag ("Lektionsplaneri / ng"). | Mjukt bindestreck (`Lektions&shy;planering`) eller `hyphens: auto` på rutornas rubrik. | liten |
| Info | Dataskydd | Den krypterade rapportfilens huvud visar klass- och lärarnamn i klartext, så att filen kan visas innan den låses upp. Inga elevuppgifter står i klartext, vilket stämmer med texten i appen. | Nämn det kort i `docs/DATASKYDD.md` om det inte redan står där. | liten |

## Det som fungerar bra

- **Rapportflödet är genomtänkt.** Lösenordsdialogen förklarar vad som
  händer om lösenordet tappas och hur det lämnas över. Matchningstabellen
  slår inte ihop något förrän läraren bekräftat. Egna noteringar och den
  egna filen dubbelräknas inte, och utskriften varnar tydligt för att den
  är okrypterad.
- **Ingen elevdata lämnar datorn.** Under hela Elevlista-testet syntes inga
  andra anrop i nätverksfliken än appens egna filer.
- **Namnspärren för klassåtgärder** hittar elevnamnet i löptext och säger
  exakt vilket namn den hittade.
- **Behörigheterna i klassåtgärder** stämmer. En kollega kan svara men inte
  ändra eller ta bort, och svaren visas snyggt under åtgärden.
- **"Radera all data" är svår att göra av misstag.** Läraren måste skriva
  klassens namn, och appen väljer aldrig automatiskt en annan klass
  efteråt.
- **Byt lösenord** ger ett tydligt meddelande per fel, markerar rätt fält
  och behåller inloggningen.
- Inga JavaScript-fel i konsolen under hela genomgången.
