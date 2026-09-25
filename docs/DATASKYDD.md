# Dataskydd — för lärare och dataskyddsombud

Kort beskrivning av var Klassrumsverktygets data finns och varför.
Princip: **ingenting om enskilda elever lämnar lärardatorn.**

## Vad som finns i molnet (Firestore, delat mellan skolans lärare)

- **Klasser** — bara klassens namn ("4A").
- **Trafikljuspass** — resultat (färg, tid), vilken lärare som körde
  passet och en ögonblicksbild av lektionen (datum, tid, ämne).
- **Anonyma noteringsräkningar** (`noteStats`) — ett "streck" per
  notering: typ (t.ex. prat, ur stol, positivt), lärare och lektion.
  **Utan elev-id, utan namn, utan text.** Det räcker för klassbilden:
  "Matte tis 10:15 (Catalin), 4A: 20 prat · 3 stol · 5 positiva".
  Säkerhetsreglerna validerar fälten, så ett elev-id eller en text kan
  inte ens skrivas dit av misstag.
- **Klassinställningar** — trafikljusets gränser, visningsläge,
  morgonskärmens hälsning och att-göra-lista. Inga elevuppgifter.
- **Lärarnas privata lektionsplaneringar** — under respektive lärares
  eget konto; ingen annan lärare kommer åt dem.

All åtkomst kräver inloggat lärarkonto (konton skapas centralt, ingen
självregistrering).

## Vad som bara finns lokalt (på varje lärardator, aldrig i molnet)

- **Elevlistan** — endast förnamn (plus valfri kort särskiljare) och
  eventuell snabbtangent per elev.
- **Noteringar** — all text, uppföljningsmarkeringar, insatser.
- **Bra jobbat-listan** och dess veckoarkiv (innehåller namn).
- **Mönster och statistik per elev.**

Datan lagras i webbläsarens lokala lagring på datorn och visas i
lärarvyerna med märkningen "Endast den här datorn". Elevskärmen
(projektorn) läser samma lokala lagring i samma webbläsare.

## Lokal gallring

Noteringar raderas automatiskt efter en valbar tid — **standard
12 veckor (en termin)**, valbart ner till 1 vecka (Översikt →
Integritet & data). Elevnoteringar sparas bara på den här datorn;
det som ska sparas långsiktigt dokumenteras i skolans ordinarie system.

En dator som före uppgraderingen hade "Spara tills vidare" (eller
ingen inställning) börjar **inte** gallra av sig själv: gallringen är
pausad tills läraren aktivt bekräftar en lagringstid i Översikten.
Inga gamla noteringar raderas alltså tyst av bytet.

## Om webbläsarens data rensas

Rensas webbläsarens lokala lagring (eller om datorn byts) försvinner
elevlistan, noteringarna och Bra jobbat på den datorn — de finns inte
i molnet och kan inte återskapas därifrån. Elevlistan skrivs då in
igen (en engångsinsats per dator). Klassens anonyma statistik och
trafikljushistorik ligger kvar i molnet och påverkas inte.

## Radering

- **En notering** som tas bort lokalt tar också bort sitt anonyma
  streck i molnet.
- **"Radera all data för klassen"** (Översikt) raderar både det lokala
  och klassens molndata (pass, anonym statistik, inställningar).

## Rapporter och överlämning mellan lärare (issue #33)

Eftersom noteringarna bara finns på varje lärardator och gallras efter
lagringstiden kan läraren ladda ned en **rapport per elev eller för
hela klassen** (Elevlista → Rapporter), till exempel efter varje vecka.
Allt sker i webbläsaren — export, kryptering, öppning och sammanslagning
fungerar helt utan nät, och appen skickar aldrig rapporten någonstans.

### Krypteringen

- Rapporten sparas som en fil med ändelsen **`.klassrum`**, krypterad
  med **AES-GCM 256**. Nyckeln tas fram ur ett lösenord som läraren
  väljer, med **PBKDF2-SHA-256 och 600 000 iterationer**, och varje fil
  får en egen slumpad salt och IV (webbläsarens inbyggda WebCrypto).
- Lösenordet måste vara minst 10 tecken (en styrkemätare hjälper till att
  välja en lång lösenfras). **Lösenordet sparas aldrig** — inte i appen,
  inte i webbläsaren. Tappar man lösenordet går filen inte att öppna.
- Filen innehåller **inga elevnamn eller noteringstexter i klartext**.
  Det enda som går att läsa utan lösenord är vem som exporterat filen,
  klassens namn, perioden och antalet elever — så att den som öppnar
  filen ser "Catalin, v.39, 4A" innan lösenordet skrivs. Filnamnet
  innehåller heller inga elevnamn (t.ex.
  `klassrum-4A-v39-2026-catalin.klassrum`).
- Ändras något i filen går den inte att öppna (krypteringen
  kontrollerar hela filen).

### Var filen bör sparas

Spara filen **där skolan anvisar** — t.ex. en skyddad mapp eller ett
krypterat USB-minne enligt skolans regler för personuppgifter. Även om
filen är krypterad innehåller den personuppgifter om elever, och den
ska gallras enligt samma regler som annat underlag.

### Överlämning mellan lärare

- Filer flyttas **för hand**, t.ex. på ett USB-minne. De går aldrig via
  molnet eller appen.
- **Lösenordet lämnas muntligt** — skriv det aldrig på USB-stickan, i
  filnamnet eller i ett mejl tillsammans med filen.
- Mottagaren öppnar filen under Elevlista → Rapporter → "Öppna
  rapportfiler" och bekräftar vilka elever i filen som motsvarar den
  egna elevlistan. Ingenting slås ihop utan lärarens bekräftelse. Det
  enda som sparas om kollegans fil är de bekräftade **namnparen**
  ("Catalins 'Mohammad' = min Mohammed") så att matchningen går fortare
  nästa gång — aldrig någon notering.

### Sammanställningar

- En sammanställning av flera lärares filer visas **bara i minnet** och
  försvinner när läraren stänger den eller lämnar fliken. Den skrivs
  inte till webbläsarens lagring, datalagret eller molnet.
- En sammanställning är **också personuppgifter** och ska hanteras på
  samma sätt som rapportfilerna. Den kan sparas som en ny krypterad
  `.klassrum`-fil (där källfilerna och lärarna framgår) med ett eget
  lösenord.

### Utskrift och PDF

Rapporter och sammanställningar kan skrivas ut eller sparas som PDF via
webbläsarens utskrift. **Utskriften/PDF:en är okrypterad** och är bara
till för att föra över uppföljningar till **skolans
dokumentationssystem**. Spara den inte löst på datorn, och förstör
pappersutskrifter när uppgifterna är överförda.

### Påminnelser

- **Måndagar** visar Elevlista en diskret banner om förra veckan har
  noteringar med uppföljning som inte laddats ned.
- **Innan den lokala gallringen** raderar noteringar med uppföljning som
  inte laddats ned visas en påminnelse (en vecka i förväg). Översikten
  frågar också innan en kortare lagringstid — eller bekräftelsen av en
  pausad gallring — raderar sådana noteringar.
- Datorn minns lokalt vilka perioder som redan laddats ned, så att
  påminnelserna inte tjatar.
