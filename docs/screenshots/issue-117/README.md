# Issue #117 — skärmdumpar

Lokalt läge (firebase-config ersatt med platshållaren vid servering, inte i
repot), påhittad testklass `4B`, planering "Läsförståelse" (Matematik) i dag.
Elevskärmen i ett eget fönster, 1920 × 1080; lärarfönstret 1440 × 900.

## Brickor i lektionen — två timrar samtidigt

"Kvar av lektionen" (räknar mot planeringens sluttid) + en nedräkning
"Läsning". Rubrikraden är trång: timerbrickorna släpper det minst viktiga
först ("Kvar", sedan kortas rubriken till "Läs…") — siffrorna kortas aldrig.

- `lektion-elev-siffror.png` — utseendet Siffror.
- `lektion-elev-stapel.png` — Stapel: tunn linje längs pillerns underkant
  som krymper (kvar av lektionen mäts mot lektionens längd).
- `lektion-elev-analog.png` — Analog klocktimer: liten röd tårtbit bredvid
  siffrorna (andel av 60 min). Här räcker platsen inte för rubriken.
- `lektion-elev-tiden-ar-ute.png` — nedräkningen är slut: röd bricka,
  "Tiden är ute", lugn pulsering (får texten inte plats visas "0:00").

## Stort på Morgonskärmen

- `morgon-elev-tre-utseenden-tiden-ar-ute.jpeg` — alla tre utseendena på en
  gång: "Kvar till 20:25" som analog klocktimer (L, uppe vänster), "Läsning"
  som stapel (M, uppe höger) och "Städning" med siffror (M, nere höger) när
  tiden är ute: "0:00" + "Tiden är ute" på rött glas. Ljud var på för
  Städning — tonen spelades en gång, i elevfönstret (inte i lärarfönstret).

## Lärarkontrollerna

- `lektion-larare-kontroller.png` — lärarvyn, sektionen Widgets: Kvar av
  lektionen (utseende, ljud) och Nedräkning 1 (rubrik, min/s, utseende, ljud,
  levande status "7:32 · Går" med Paus/Återställ).
- `lektion-larare-bricka-hover.png` — musen över nedräkningens bricka i
  förhandsvisningen: små Paus/Återställ-knappar som lager över brickan. Finns
  bara i lärarvyn, aldrig på elevskärmen.
- `morgon-larare-kontroller.jpeg` — Morgonskärmens panel: två nedräkningar
  med plats/storlek, fälten och körknapparna; små knappar direkt på de stora
  widgetarna.
