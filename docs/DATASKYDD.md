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
