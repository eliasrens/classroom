# Issue #81 — SO-/NO-delämnen + "Mina ämnen" per lärare

Headless Chrome, lokalt läge (apiKey `FYLL_I…`), påhittad klass TEST-81 med en
planering per nytt delämne i vecka 39 (21–27 sep 2026). Elevvyer 1920×1080,
planeringslistan 1920×1700 med listan uppfälld.

## Delämnena

Sju nya ämnen: `re` Religionskunskap, `hi` Historia, `ge` Geografi,
`sh` Samhällskunskap (SO-familjen, gul) samt `bi` Biologi, `ke` Kemi,
`fy` Fysik (NO-familjen, mörkgrön). Varje delämne ligger i samma färgfamilj
som sitt huvudämne — eleverna känner igen "SO" och "NO" från schemat — men i
nyanser som går att skilja åt sida vid sida i planeringslistan (minsta
RGB-avstånd inom en familj spärras i `docs/test-subjects.mjs`). Huvudämnena
SO och NO finns kvar för ämnesövergripande arbete, liksom Teknik. Alla
befintliga id:n och färger från #77 är oförändrade. `group: "so" | "no"`
binder delämnena till huvudämnet; `groupedSubjects` i `js/lib/color.js`
grupperar dem under rubrikerna "SO-ämnen"/"NO-ämnen" i väljare och dialog.

## Kontrasttabell (tavlans rubrikrad: ämnesfärg mot framräknad textfärg)

WCAG AA kräver ≥ 4,5. Tabellen genereras av `node docs/test-subjects.mjs`,
som också spärrar regressioner — inklusive `--subj-deep`-etiketterna
(`deepTextColor`) mot vitt för alla ämnen.

| Ämne | Färg | Textfärg | Kvot | AA |
|---|---|---|---|---|
| Svenska/SVA (sv) | #ad3a30 | #ffffff | 6.13 | ✅ |
| Engelska (en) | #7463ad | #ffffff | 5.08 | ✅ |
| Matematik (ma) | #3a63a6 | #ffffff | 5.97 | ✅ |
| SO (so) | #e2bc3f | #1f2430 | 8.50 | ✅ |
| Religionskunskap (re) | #ecd06e | #1f2430 | 10.21 | ✅ |
| Historia (hi) | #c1922c | #1f2430 | 5.48 | ✅ |
| Geografi (ge) | #b8c454 | #1f2430 | 8.17 | ✅ |
| Samhällskunskap (sh) | #e39434 | #1f2430 | 6.32 | ✅ |
| NO (no) | #2f6b4f | #ffffff | 6.29 | ✅ |
| Biologi (bi) | #4c7d3f | #ffffff | 4.87 | ✅ |
| Kemi (ke) | #237571 | #ffffff | 5.45 | ✅ |
| Fysik (fy) | #5e6b2a | #ffffff | 5.81 | ✅ |
| Teknik (tk) | #2f6b4f | #ffffff | 6.29 | ✅ |
| Idrott & hälsa (idh) | #eb9d8e | #1f2430 | 7.20 | ✅ |
| Bild (bl) | #84573f | #ffffff | 6.15 | ✅ |
| Musik (mu) | #7d6e5f | #ffffff | 4.92 | ✅ |
| Slöjd (sl) | #a9c8a4 | #1f2430 | 8.49 | ✅ |
| Mentorstid (mentor) | #9aa0a8 | #1f2430 | 5.89 | ✅ |
| Rast/övrigt (rast) | #d7d3cb | #1f2430 | 10.40 | ✅ |

## Mina ämnen

Privat per lärare: `teachers/{uid}/settings/subjects → { mine: [id, …] }`
(datalagret — offline-först, följer läraren mellan datorer; se DATAMODELL.md).
Inget val = alla ämnen visas, som förut. Filtreringslogiken testas i
`docs/test-my-subjects.mjs`, inklusive att en planerings redan valda ämne som
inte är bland mina ändå visas i väljaren. Verifierat i headless Chrome med två
uid:n ("local" och "larare-b") som har olika val utan att påverka varandra.
Eget nytt ämne läggs automatiskt till i "Mina ämnen"; "Lägg till … i mina
ämnen" visas som kvickväg under Ämne-fältet när planeringens ämne inte är
bland mina.

## Skärmdumpar

- `elev-<ämne>.png` — tavlan i elevvy (#/elev/lektion) för alla 7 nya delämnen;
  rubrikraden visar delämnets namn ("Religionskunskap", "Kemi", …)
- `planeringslista-ljus.png` — planeringslistan med SO- och NO-delämnena sida
  vid sida (uppfälld lista, ljust tema)
- `amnesvaljare-fore.png` — ämnesväljaren FÖRE valet: alla ämnen, grupperade
  under "SO-ämnen"/"NO-ämnen", längst ner "+ Eget ämne…" och "Välj mina ämnen…"
- `dialog-valj-mina-amnen.png` — dialogen med kryssrutor, grupper och
  knapparna "Alla SO"/"Alla NO"
- `amnesvaljare-efter.png` — väljaren EFTER valet: bara mina ämnen plus
  "Visa alla ämnen…" och "Välj mina ämnen…"
- `kopierad-plan-annat-amne.png` — kopierad planering med ämnet Musik (inte
  bland mina): ämnet visas ändå i väljaren och kvickvägen
  "Lägg till \"Musik\" i mina ämnen" erbjuds under fältet
- `installningar-mina-amnen.png` — Översikt › Inställningar med den nya
  sektionen "Mina ämnen" (sammanfattning + "Välj mina ämnen…")
