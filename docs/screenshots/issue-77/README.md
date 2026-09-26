# Issue #77 — Ämnesfärger som matchar skolans schema + nytt ämne Mentorstid

Headless Chrome, lokalt läge (apiKey `FYLL_I…`), påhittad klass TEST-77 med en
planering per ämne i vecka 39 (21–27 sep 2026). Alla vyer 1920×1080
(planeringslistan 1920×1700 med listan uppfälld så att alla 12 ämnen syns).

## Paletten

Färgfamiljerna följer skolans veckoschema men i mjukare, mattare toner än
schemats tryckfärger. `tk` delar färg med `no` (No/Tk är samma block i
schemat). Nytt ämne `mentor` ("Mentorstid") i grått. `rast` är neutral ljus
och ligger kvar sist i `SUBJECTS` (fallback). Id:n är oförändrade, så
befintliga planeringar behåller sina ämnen. Lärarnas egna ämnen
(`settings/subjects` → `mergedSubjects`) påverkas inte.

## Kontrasttabell (tavlans rubrikrad: ämnesfärg mot framräknad textfärg)

WCAG AA kräver ≥ 4,5. Tabellen genereras av `node docs/test-subjects.mjs`,
som också spärrar regressioner (kör i CI-rutinen med övriga `docs/test-*.mjs`).

| Ämne | Färg | Textfärg | Kvot | AA |
|---|---|---|---|---|
| Matematik (ma) | #3a63a6 | #ffffff | 5.97 | ✅ |
| Svenska/SVA (sv) | #ad3a30 | #ffffff | 6.13 | ✅ |
| Engelska (en) | #7463ad | #ffffff | 5.08 | ✅ |
| NO (no) | #2f6b4f | #ffffff | 6.29 | ✅ |
| SO (so) | #e2bc3f | #1f2430 | 8.50 | ✅ |
| Idrott & hälsa (idh) | #eb9d8e | #1f2430 | 7.20 | ✅ |
| Bild (bl) | #84573f | #ffffff | 6.15 | ✅ |
| Musik (mu) | #7d6e5f | #ffffff | 4.92 | ✅ |
| Slöjd (sl) | #a9c8a4 | #1f2430 | 8.49 | ✅ |
| Teknik (tk) | #2f6b4f | #ffffff | 6.29 | ✅ |
| Mentorstid (mentor) | #9aa0a8 | #1f2430 | 5.89 | ✅ |
| Rast/övrigt (rast) | #d7d3cb | #1f2430 | 10.40 | ✅ |

Tavlans små fältetiketter (VAD, HUR, …) i ämnesfärg på det vita pappret
använder nu `--subj-deep` — ämnesfärgen mörknad tills den klarar AA mot
pappret (`deepTextColor` i `js/lib/color.js`, testas också i
`test-subjects.mjs`). Ljusa ämnen (gul, salvia, neutral) var annars oläsliga
som etikettfärg. Listornas ämnesprickar fick en diskret inre ring
(`box-shadow`, ingen layoutändring) så att rast/mentorstid syns i ljust tema.

## Skärmdumpar

- `elev-<ämne>.png` — tavlan i elevvy (#/elev/lektion) för varje ämne
- `elev-ma-bra-jobbat.png` — tavlan efter merge med #78: Bra jobbat-rubriken
  (guldstjärna + guldstreck) tillsammans med de nya ämnesfärgerna
- `planeringslista-ljus.png` — planeringslistan med alla 12 ämnen, ljust tema
- `larare-ljus.png` / `larare-mork.png` — lärarvyn i ljust respektive mörkt tema
