# QA 2: Verktyg — Trafikljus, Skrivtavla, Tankekarta, Lottning, Veckans övergångar (issue #97)

Testad 2026-09-27, i lokalt läge (Firebase-apiKey tillfälligt överstyrd,
ingen riktig klassdata rörd) med den påhittade testklassen **QA-TEST-97**
(26 fiktiva elever). Ingen riktig klass (4A–4D) har öppnats. Elevvyn
testades i ett separat elevskärmsfönster (`#/elev/…`) som fick innehållet
via "Visa på elevskärm", precis som i klassrummet.

## Vad som testades

**Skärmstorlekar:** 1920×1080, 1366×768 och 1280×720, lärarvy och elevvy,
alla fem verktygen — automatisk svep som mäter horisontell scroll och
element utanför fönstret: **inga träffar** (en flyktig träff på `.kt-scene`
vid 1366 visade sig vara mitt-i-omritningen; efter att ResizeObserver-refiten
satt sig är scenen exakt fönsterbred och ingen bubbla klipps).
**Tema:** lärarvyns mörka standardtema och ljusa läget (växlaren); elevvyns
tavla är alltid ljus. **Utskrifter:** riktiga PDF:er via CDP
`Page.printToPDF` (samma väg som webbläsarens "Spara som PDF"), sidantal
och `MediaBox` kontrollerade, sidorna renderade med pdf.js och granskade.

**Trafikljusur** (`js/modes/trafikljus.js`):

- Två typer med egna gränser: Övergång (förval gult 1:00 · rött 2:00) och
  Datorer (gult 3:00 · rött 5:00). Gränserna kan ändras per typ, sparas i
  `settings/trafikljus` och visas i typväxlarens rad. ✔
- Start, stopp, återställ; färgbyten på exakt rätt sekund (testat med
  gult 6 s / rött 12 s: grönt vid 2 s, gult vid 6,6 s, rött vid 12,6 s),
  klockan fryser vid stopp. Elevskärmen visar samma tid och fas (synk via
  bussen, ±1 s). ✔
- Spara pass: knappen blir "Pass sparat", passet loggas med lärare, tid
  och pågående lektion ur planeringen ("Bråk intro" med en planering som
  täcker klockslaget). Rekord: första gröna passet ger "Nytt rekord!" —
  ett rött pass sätter aldrig rekord. ✔
- Veckomål (mot förra veckans pass, seedade för v.38): snitt/bästa/total
  per typ, målrad med "just nu … ✓", måttbyte i väljaren skrivs till delade
  inställningar. "Visa veckomålet för eleverna" ger elevskärmen en diskret
  rad ("Veckans mål: snitt under 2:03" resp. "3:10" för Datorer) — aldrig
  namn eller statistik. ✔
- Statistik: filter per lärare (Alla/Mina/Kollega) filtrerar veckans lista
  och räkningar men aldrig veckomålet (hela klassens); typflikarna byter
  statistik utan att röra klockan. Historiken visar lärare, tidpunkt,
  lektion och färgprick. ✔
- Klassåtgärd efter sparat pass: knappen dyker upp, dialogen öppnas,
  namnspärren stoppade "Alma fick prova…" med hänvisning att skriva om,
  omskriven text utan namn sparades och delades. ✔
- Typen är låst medan ett pass finns ("Återställ för att byta typ"),
  radiogruppens piltangenter fungerar; Mellanslag = start/stopp, R =
  återställ. En igångvarande klocka överlever byte av läge (< 30 min). ✔
- Elevvyn: bara klocka, färg och (tillval) målraden; "Datorer"-etiketten
  bara när datorljuset gäller. ✔

**Skrivtavla** (`js/modes/skriv.js`, `js/modes/skriv/print.js`):

- Live till elevskärmen medan läraren skriver; samma radbrytningar
  (storleken är en andel av papperets bredd — lärarens 53,8 px motsvarade
  elevens 76,9 px i det bredare fönstret, samma 35 rader). ✔
- A−/A+ (1–6), "Följ skrivandet": raden man skriver på hålls högt upp;
  hjul-scroll stänger av Följ och elevskärmen följer lärarens scrolläge
  (radnummer, inte px); knappen slår på Följ igen och scrollar ikapp. ✔
- Ny sida med bekräftelse ("sparas bland de 10 senaste"), bläddring
  Sida 1/2 med bevarad text åt båda håll; elevskärmen byter sida direkt.
  Ångra/Gör om via knapparna (webbläsarens historik i textarean). ✔
- Papperet: varmvit botten, mörkgrå linjer, bokstäverna står på linjen
  (uppmätt baslinje), både lärar- och elevvy. ✔
- **Utskrift**: panel med rubrikfält, sidval (förvald aktuell sida, "Alla"
  med mellanläge), Esc stänger. PDF:en är exakt A4 (595×842 pt,
  `@page margin 0` + `preferCSSPageSize`), ett ark = 209×296,5 mm med
  ~15 mm vit padding (56,7 px uppmätt) — marginalen finns kvar oavsett
  marginalval i dialogen (#55-mekaniken). Varje ark har eget sidhuvud
  (klass · rubrik · datum), 27 hela rader per ark (en rad klipps aldrig
  mellan ark) och sista arket är **linjerat ända ner** med tomma linjer.
  Dokumenttiteln (= PDF-filnamnsförslag) blir "Skrivtavla QA-TEST-97
  2026-09-27", utan elevnamn. Ctrl+P-vägen (beforeprint utan panel) bygger
  arket av aktuell sida — 1 A4-sida verifierad. Se
  `docs/screenshots/issue-97/skriv-pdf-sida1.png` och
  `skriv-pdf-sista-arket.png`. ✔

**Tankekarta** (`js/modes/karta.js`):

- Ny karta är helt tom (tom rubrik, "Ny karta" bara i listan tills namn/
  rubrik finns); rubriken skrivs i molnet och uppdaterar listnamnet. ✔
- Grenar: klick markerar (ring + ×), skrivraden byter till "Lägg till
  under ”Löv”", Enter lägger grenar en i taget, tre nivåer — markerad
  undergren på nivå 3 ger nya bubblor bredvid (verifierat i datat:
  Kastanj→Ek). Esc, klick på molnet eller tom yta går till huvudnivån. ✔
- Redigering: dubbelklick/F2 öppnar contenteditable, Enter sparar; status
  "Bubblan ändrad. Ångra tar tillbaka den gamla texten." ✔
- Borttagning: ×/Delete tar bort markerad bubbla med alla grenar ("”Ek”
  och 2 grenar togs bort"), Ångra tar tillbaka allt i rätt ordning.
  Ångra täcker även färg, moln, auto-färg, flytt, Töm tavlan och Ordna
  automatiskt (alla åtta op-typerna testade). ✔
- Färger: molnets 8 färger; markerad bubbla får egen palett + "Som
  föräldern" (ljusare nyans) för grenar; "Färglägg automatiskt" av → alla
  huvudbubblor neutrala, Ångra återställer var och en. ✔
- Dra: pointer-drag pinnar bubblan (grenarna följer), "Ordna automatiskt"
  dyker upp, släpper alla pins och kan ångras. ✔
- Layout: 32 bubblor lades ut **utan ett enda överlapp** och utan att
  någon hamnade utanför scenen (parvis rektangelmätning). ✔
- Flera kartor: andra kartan skapades, arbete i den rörde **inte**
  elevskärmen — eleverna såg kvar "Hösten" tills nästa "Visa på elevskärm"
  (issue #88); nya bubblor i den utskickade kartan syns live; togs den
  utskickade kartan bort blev elevskärmen "Ingen tankekarta visas." —
  aldrig ett tyst byte. 🖵-märket i kartlistan pekar på den utskickade. ✔
- **Utskrift**: fyra papper (A3/A4, liggande/stående, A3 liggande förval,
  valet sparas). A3 liggande: 1 sida, 1191×842 pt (= 420×297 mm); A4
  stående: 1 sida, 595×842 pt. Kartan räknas om till papperets yta —
  alla 32 bubblor på sidan, färger med, sidhuvud klass + datum, vit
  marginal (arket 419×296,5 mm med 15 mm padding). Ctrl+P bygger arket
  med valt papper. Se `docs/screenshots/issue-97/karta-pdf-a3.png`. ✔

**Lottning** (`js/modes/lotta.js`, `js/modes/lotta/stage.js`):

- Alla fyra sätten under 3 s: hjul 2,7 s, namnrulle 2,5 s, dra en lapp
  2,6 s, direkt 0,3 s. Elevskärmen spelar samma animation och landar på
  **samma resultat** (verifierat för hjul, lapp och direkt, även offline). ✔
- **Skärpan i "Dra en lapp" (#91):** högens lappar ligger i scale 0,370
  (= 1/2,7) och den dragna lappen i scale(1) — texten och ikonerna ritas i
  full upplösning. Skärmdumpen `lotta-elev-lapp-1920.png` visar knivskarp
  text ("Maja!"). ✔
- Klassen: närvarorutan ("Bocka ur den som är frånvarande. Gäller bara
  idag."), två frånvarande gav "24 kvar av 24" (frånvarande räknas bort ur
  bägge talen), "Alla är här"-knappen. ✔
- Inga upprepningar: på för Klassen som standard — dragna hamnar under
  "Redan dragna" i dragordning och kan inte dras igen; "Ångra senaste" tar
  tillbaka senast dragna; "Hela klassen på nytt" nollställer. När alla
  dragits: "Alla har dragits — börja om?" med knapp, Dra inaktiverad. ✔
- Färger: 12 färger, 8 förvalda, kryssen styr poolen direkt; utan
  "ta bort den som dragits" visas "N att dra bland" och Ångra rensar bara
  resultatet. ✔
- Egna listor: "Ny lista" fokuserar namnfältet, en rad per alternativ,
  listknappen följer namnet, "Ta bort listan" med bekräftelse städar
  dokument, dragna och inställningar och går tillbaka till Klassen. ✔
- Hjulvarning: 24–26 namn ger "texten blir liten på hjulet" med
  "Byt till namnrulle"-knapp. Mellanslag = Dra. ✔
- Elevvyn visar bara scenen — aldrig listorna eller panelen. ✔

**Veckans övergångar** (`js/modes/vecka.js`):

- Alla fyra sidorna: Översikt (antal + färgplattor + heja-rad), Dag för
  dag (mån–sön med tider och färg per pass), Snabbaste (tid, dag, klockslag,
  lektion), Målet (mål, ert värde, klarat/inte klarat + trendstaplar
  v.38/Denna). ✔
- Bläddring: ←/→, PageUp/PageDown, Home/End och sidknapparna — elevskärmen
  följer varje byte (verifierad på "Sida 4 av 4"). ✔
- Mål klarat: "Målet klarat!"-bricka, konfetti **en gång och bara på
  elevskärmen** (lärarens förhandsvisning fick 0 bitar). Mål inte klarat
  (testat genom att tillfälligt seeda ett 10-minuterspass): "Bra kämpat!
  32 sekunder från målet" och "Nytt försök nästa vecka." på söndagen. ✔
- Veckoväljaren: förra veckor kan väljas, "Nästa"/"Denna vecka" inaktiveras
  på innevarande; Datorer-knappen bara aktiv när veckan har datorpass
  ("Inga datorpass den veckan" annars); v.38 (första veckan med pass) ger
  "Nu har ni ett mål att slå!" med nästa veckas mål. ✔
- Integritet: elevvyns DOM innehåller **inga lärarnamn** och inga
  noteringar — bara tider, färger, dagar och lektionsnamn. ✔

## Rättad bugg

**"Mer än hälften gröna" vid exakt hälften** (`js/modes/vecka.js`).
Översiktens heja-rad valdes med `share >= 0.5`, så en vecka med t.ex.
1 grönt av 2 pass fick "Bra jobbat — mer än hälften gröna!" — ett
faktafel på elevskärmen (hälften är inte *mer än* hälften). Nu `> 0.5`;
exakt hälften får i stället den ärliga raden "Bra kämpat! Varje gång är
en ny chans." Före/efter:
`docs/screenshots/issue-97/vecka-cheer-fore.png` /
`vecka-cheer-efter.png`.

## Gemensamt

- **Konsolen:** inga fel eller varningar i vare sig lärar- eller
  elevfönstret under hela genomgången (alla fem verktygen, utskrifter,
  temabyten, storleksändringar).
- **`prefers-reduced-motion: reduce`:** hjuldragningen blir en kort toning
  (0,3 s i stället för 2,7 s) med samma resultat; Veckans övergångar
  hoppar över konfettin (0 bitar vid klarat mål) och sidtoningen.
- **Offline:** i lokalt läge fungerar allt utan nät (lottning drog "Leo!"
  med `navigator.onLine === false` och elevskärmen visade samma resultat) —
  all verktygsdata är lokal (`classroom:local:*`, aldrig Firestore).
- **Tangentbord:** Trafikljus (mellanslag/R/pilar i typväxlaren), Lottning
  (mellanslag), Tankekarta (Enter/Esc/Delete/F2/pil upp-ner/Ctrl+Z),
  Skrivtavla (Ctrl+Z/Y via knapparna, Esc i utskriftspanelen), Veckans
  övergångar (pilar/PageUp/PageDown/Home/End) — allt enligt hjälptexterna.
- **Integritet:** Skrivtavlans, Lottningens och Tankekartans data ligger
  enbart i `classroom:local:*`; utskrifternas PDF-titlar innehåller klass
  och datum men aldrig elevnamn; elevvyerna visar aldrig lärarnamn,
  listor eller statistik.

## Skärmdumpar

`docs/screenshots/issue-97/`: trafikljus-larare-1920, trafikljus-elev-1920,
trafikljus-larare-ljust-1920, skriv-larare-1920, skriv-elev-1920,
skriv-pdf-sida1, skriv-pdf-sista-arket, karta-larare-1920, karta-elev-1920,
karta-pdf-a3, lotta-larare-1920, lotta-elev-lapp-1920, vecka-larare-1920,
vecka-cheer-fore, vecka-cheer-efter.

## Testsviter

Alla 16 sviter i `docs/test-*.mjs` gröna efter rättningen (bl.a.
test-karta 1988 OK, test-lotta 1996 OK, test-week-goal 44 OK,
test-week-recap 29 OK), körda med riktig `js/firebase-config.js`
(attrapper, inget nät). `node --check` ren på ändrade filer.
