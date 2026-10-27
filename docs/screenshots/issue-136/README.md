# Issue #136: "Efter rasten" utan Lektionsordning — smal egen kolumn

Lokalt läge (Firebase-konfigurationen ersatt med platshållaren av en lokal
testserver, inget moln) med den påhittade klassen `TEST-136`. Planeringen har
Vad, Hur, Varför, När du är klar, Du behöver och Mål med vanlig text,
Lektionsordning AV och "Efter rasten" med tre punkter (starttid 23:30, så
timern står still på 10:00). "Före" är `main` (`f62533e`).

| Fil | Visar |
|---|---|
| `fore-larare-1280-ruta.png` | Före: rutan i en full mittenkolumn (flex 4.5), `--lb-scale` 0.673 |
| `efter-larare-1280-ruta.png` | Efter: smal kolumn (16 % av mittenraden), `--lb-scale` 0.792, rutans egen skala 0.59 |
| `efter-elev-1920-ruta.png` | Elevskärmen 1920×1080: `--lb-scale` 0.799, inga sidokolumner klipps |
| `efter-elev-1920-efter-dolj-nu.png` | Efter "Dölj nu": kolumnen borta, sidokolumnerna breddade, `--lb-scale` 0.888 |

## Mätt i webbläsaren

- Samma planering utan rutan: `--lb-scale` 0.888. Tavlan står då på sin
  största skala som ryms, så sidokolumnerna klipps så fort kolumnen tar
  plats. Enligt beslut (alternativ B) sänks skalan då bara så mycket som
  behövs med kolumnen på golvet: 0.792 (1280) / 0.799 (1920), mot 0.673 före.
  Inget överflöd i någon sidokolumn.
- Kort text (tavlan på skala 1): `--lb-scale` 1.000 med och utan rutan,
  kolumnen på taket 30 %.
- "Dölj nu": skalan står still under toningen (stickprov var 100 ms), och
  när kolumnen tagits bort räknas den om till 0.888 — samma som utan rutan.
- Lektionsordning på, 4 steg + rutan: `--lb-steps-scale` 1. 16 steg: 0.66,
  sista stegets underkant = kroppens underkant; rubriken krymps lika mycket.
