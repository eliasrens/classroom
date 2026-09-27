# QA 1: Rutiner — Morgonskärmen och Lektionsplaneringen (issue #93)

Testad 2026-09-27, i lokalt läge (Firebase-apiKey tillfälligt överstyrd, ingen
riktig klassdata rörd) med den påhittade testklassen **QA-TEST-93**
(26 fiktiva elever) och den tomma klassen QA-TOM-93. Ingen riktig klass
(4A–4D) har öppnats.

## Vad som testades

**Skärmstorlekar:** 1920×1080 och 1280×720, lärarvy och elevvy.
**Tema:** lärarvyns mörka standardtema samt ljust läge (växlingsknappen);
elevvyns tavla är alltid ljus.

**Morgonskärmen** (`js/modes/morgon.js`, `css/modes/morgon.css`,
`js/ui/praise-board.js`):

- Hälsning: Godmorgon/Välkommen-växling, egen text åsidosätter, tom text
  går tillbaka till klassnamnet. ✔
- Att göra: kryssrutor, listan följer ikryssningsordningen, Startens
  dag-chips (Mån–Fre), penna med redigering direkt i raden ("Eleverna ser"),
  Enter/✓ sparar, Esc/✕ avbryter, tom text ger hinten "Texten kan inte vara
  tom" utan att spara, Återställ syns bara när elevtexten ändrats och går
  tillbaka till originalet, egna uppgifter läggs till (auto-ikryssade, sist)
  och tas bort. ✔ (en bugg rättad, se nedan)
- Bra jobbat: elever kryssas i/ur, fritext läggs till, Töm tömmer (både
  panelknappen och papperskorgen på tavlan), guldstjärna + guldstreck,
  27 namn lades ut i två kolumner utan scroll (mätt: `scrollHeight` =
  `clientHeight`), tavlan dold för elever när den är tom. ✔
- Bakgrund: Slumpa tar en bild ur rätt årstid (hinten säger "Slumpa tar en
  höstbild"), Välj bild-dialogen visar kategorierna Höst/Vinter/Vår/Sommar/
  Platser i världen med nuvarande bild markerad, egen URL och uppladdad fil
  fungerar (hamnar i extraUrls), och ett manuellt val stämplas med dagens
  datum ("Ditt val gäller i dag") och slumpas inte bort vid omladdning. ✔
- Fällbara sektioner: öppet/stängt sparas per dator, sammanfattningarna på
  rubrikraderna stämmer ("4 uppgifter · 2 visas", "27 namn", hälsningstexten,
  bakgrundens namn + miniatyr). Panelen kan fällas in helt och tavlan/kortet
  flyttar med; läget sparas. ✔
- Elevvyn: hälsning, numrerad lista och Bra jobbat-tavla utan överlapp eller
  klippt text vid 1920 och 1280; ändringar i lärarfönstret (annan flik) slår
  igenom direkt via storage-synk. ✔

**Lektionsplaneringen** (`js/modes/lektion.js`, `css/modes/lektion.css`):

- Ny planering öppnar "Om lektionen" och fokuserar Namn-fältet. ✔
- ⋯-menyn: Kopiera (till samma veckodag framåt; samma dag ger "(kopia)" och
  en statusrad med förklaring), Ta bort med bekräftelse (fokus på Avbryt,
  Avbryt/Esc stänger), Välj flera med "Markera alla synliga", antal och
  "Ta bort markerade". ✔
- Sök + ämnesfilter: filtret listar bara ämnen som används av planeringarna
  (plus mina ämnen); sökning inom fliken med raden "N träffar i Kommande/
  Arkiv" och fliken byts vid klick. ✔
- Flikar: Denna vecka (inkl. "Utan datum"), Kommande (närmaste vecka först)
  och Arkiv (nyaste först) med veckogrupper, antal per vecka och fällbara
  block; vald flik sparas per dator. Testat med 36 planeringar. ✔
- Fällbara "Om lektionen" och "Fält" med sammanfattningar ("Bråk intro ·
  Matematik · sön 27 sep.", "Vad, Att göra, Mål visas"). ✔
- Fält-kryssrutorna slår av/på fält och layouten omfördelar sig utan hål. ✔
- Mina ämnen: dialogen sparar valet, väljaren visar bara mina + "Visa alla
  ämnen…" (visar hela paletten tillfälligt utan att röra planeringen),
  hinten "Lägg till 'Engelska' i mina ämnen" när planeringens ämne inte är
  mitt, och knappen lägger till det. Eget ämne skapas med namn + HEX-färg,
  får läsbar textfärg automatiskt och läggs till i mina ämnen. ✔
- Ämnesfärger: alla ämnen har färg; SO-delämnena delar SO:s färg och
  NO-delämnena NO:s (avsiktligt, `js/lib/color.js`), egna ämnen får sin
  valda färg med mörkad variant för text på det vita pappret. ✔
- Tavlans skalning: normala texter skalas utan scroll (t.ex. --lb-scale
  0.68 med alla nio fält ifyllda); Bra jobbat-rutan på tavlan visar samma
  namn som Morgonskärmen och kryssrutans hint anger antalet. ✔
- Förhandsramen: streckad ram + "Förhandsvisning · Eleverna ser: … · Gå dit"
  när öppnad ≠ utskickad; "Gå dit" öppnar den utskickade och ramen
  försvinner; "Visas nu"-brickan i listan. "Visa på elevskärm" är guld när
  något annat visas och grön "Visas för eleverna" när samma planering
  visas. Tas den visade planeringen bort blir elevskärmen tom ("Ingen
  planering visas"), aldrig ett tyst byte. ✔
- Elevvyn: exakt den utskickade planeringen, ren tavla, läsbar vid 1920 och
  1280 även med alla fält + Bra jobbat-rutan. ✔
- Kantfall: tom klass ("Inga planeringar ännu", inaktiverad redigerare,
  tomläge på tavlan), planering utan ämne (blir SO, förvalet), planering
  med okänt ämnes-id (tavlan faller tillbaka till Rast/övrigt), planering
  utan datum (hamnar under "Utan datum" i Denna vecka), 36 planeringar,
  klassbyte fram och tillbaka (redigerad planering och "Visas nu" minns),
  omladdning (flik, redigerad planering och utskickat val består). ✔

**Testsviter:** alla `docs/test-*.mjs` körda — gröna (589+39+25+1988+1996+
20+28+70+179+44+29+24 kontroller m.fl., test-clock/nav/outbox/present "ALLA
OK"). Obs: `test-karta`, `test-lotta`, `test-clock` och `test-outbox` kräver
att `js/firebase-config.js` har den riktiga konfigurationen — med apiKey
överstyrd till "FYLL_I…" faller de (väntat, de testar synkvägen).

## Rättade buggar

### 1. "Eleverna ser: Starten – …" i panelen uppdaterades inte när dagen byttes

**Vad:** När läraren bytte Startens veckodag med dag-chipsen (Mån–Fre)
uppdaterades tavlan direkt, men raden "Eleverna ser: Starten – Måndag" i
panelen stod kvar på den gamla dagen tills sidan laddades om. Panelen och
tavlan sa alltså olika saker om vad eleverna ser.

**Varför:** Chip-hanteraren sparade ändringen (`commit`), men
`syncPanel()` uppdaterar bara kryssrutor/radioknappar — radtexten byggs av
`renderTaskControls()`, som aldrig anropades (borttagning av uppgift gjorde
redan så).

**Rättning:** `js/modes/morgon.js` — chip-hanteraren anropar nu
`commit(next).then(renderTaskControls)`, precis som borttagningen.

**Före:** `docs/screenshots/issue-93/morgon-starten-chip-fore.png`
(chippen står på Ons och tavlan säger "Starten – Onsdag", men panelraden
säger "Starten – Fredag").
**Efter:** `docs/screenshots/issue-93/morgon-starten-chip-efter.png`
(chip, panelrad och tavla säger alla Onsdag).

## Fynd som inte är rättade

| Allvar | Typ | Beskrivning | Förslag | Insats |
|---|---|---|---|---|
| Medel | UX | Lektionstavlan krymper som mest till 45 % (`FIT_MIN` i `js/modes/lektion.js`). Med extremt mycket text (flera hundra ord i flera fält) klipps resten av texten utan markering — sista raden kan kapas mitt i. Läraren ser samma klippning i förhandsvisningen, så det är sällan en överraskning, men inget säger "allt får inte plats". | Visa en diskret varning i lärarvyn när tavlan slagit i minsta skalan (t.ex. "Allt ryms inte — korta texterna"), alternativt låt skalan gå längre ner. | liten |
| Låg | UX | På Morgonskärmens lärarvy kan Bra jobbat-tavlan hamna bakom den flytande Elevskärm-panelen nere till höger när listan är lång (namn skyms). Elevvyn påverkas inte, och panelen kan fällas ihop. | Låt tavlans maxhöjd/placering ta hänsyn till elevskärmspanelen, eller gör panelen mer genomskinlig/hopfälld som standard på Morgonskärmen. | liten |
| Låg | Bugg | Planering med okänt/trasigt ämnes-id (kan uppstå om en kollegas egna ämne inte finns lokalt): tavlan visar "Rast/övrigt" men ämnesväljaren i "Om lektionen" blir tom (inget valt). Ingen krasch. | Låt väljaren visa samma reservval som tavlan, eller en rad "Okänt ämne". | liten |
| Låg | Tillgänglighet | Chrome flaggar "A form field element should have an id or name attribute" för ca 29 fält (panelens inputs styrs via klasser/data-attribut). Ingen funktionspåverkan, men autofyll/verktyg känner inte igen fälten. | Ge fälten `name`/`id` vid tillfälle. | liten |
| Låg | UX | Datum/tid-fälten i "Om lektionen" är webbläsarens inbyggda och följer webbläsarens språk — i en engelsk webbläsare visas "09/27/2026" och "08:15 AM". På lärarnas svenska datorer visas svenskt format. | Ingen åtgärd krävs; ev. `lang="sv"`-attribut på fälten. | liten |

## Det som fungerar bra

- **Morgonskärmen känns färdig.** Redigeringen direkt i raden (#87) är
  genomtänkt: tom text stoppas snyggt, Esc/klick-utanför beter sig rätt,
  Återställ visas bara när det behövs. Bra jobbat-tavlan lägger själv om
  27 namn i kolumner utan scroll och håller namnstorleken i takt med
  uppgiftsraden. Årstidslogiken för bakgrunder ("Slumpa tar en höstbild",
  manuellt val gäller dagen) fungerar precis som beskrivet.
- **En enda "Visa på elevskärm" (#88) håller vad den lovar.** Guld/grön
  knapp, förhandsram med "Gå dit", "Visas nu"-brickan och tomläget när den
  visade tas bort — alla vägar prövades och ingen bytte planering i tysthet.
- **Listan skalar.** 36 planeringar över sju veckor grupperas rätt i
  flikarna, sökningen hittar innehåll (inte bara namn) och raden "15
  träffar i Kommande" gör att inget "försvinner" bakom fel flik.
- **Mina ämnen (#81)** gör precis lagom mycket: inget försvinner (planens
  eget ämne visas alltid), och kvickvägen "Lägg till i mina ämnen" dyker
  upp exakt när den behövs.
- **Synken mellan fönster** (lärarvy ↔ elevskärm) slog igenom direkt i
  varje test, även för Bra jobbat som bara lever lokalt.
- Inga JavaScript-fel i konsolen under hela genomgången, i någon vy.
