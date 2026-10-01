# Issue #123: kompaktare widget-inställningar

Lärarvyn i lokalt läge med den påhittade testklassen `TEST-123`. Ingen riktig
klass och inget moln är inblandat. Bilderna visar lärarpanelen med sektionen
**Widgets**.

- **Lektion:** planeringen "Läsförståelse" i dag med Nedräkning "Läsning"
  (8:00) och Klocka (analog).
- **Morgonskärmen:** Klocka (analog) uppe till vänster i L, Nedräkning
  "Läsning" nere till höger i M och Kvar till klockslag 23:30 uppe till
  höger i M.

"Före" är `main` (`774b977`) och "efter" är den här grenen. Båda serverades
från samma adress, med samma seedade data och svensk webbläsare
(`--lang=sv-SE`).

Filnamn: `{fore|efter}-{lektion|morgon}-{morkt|ljust}-{1920|1280}-{tillstånd}.png`

| Tillstånd | Visar |
|---|---|
| `1-stangd` | Sektionen stängd. Efter: sammanfattningen "Nedräkning, Klocka" / "Klocka, Nedräkning, Kvar till klockslag". Före: "Nedräkning, Klocka (analog)" |
| `2-oppen` | Sektionen öppen. Före: alla sex typer med kryssrutor och alla inställningar utfällda. Efter: en rad per aktiv widget och "+ Lägg till widget" |
| `3-installningar` | (bara efter) ⚙ på första widgeten. Lektion: Nedräkningens rubrik, tid, utseende, ljud och Återställ. Morgon: analoga klockans plats, storlek och sekundvisare |
| `4-meny` | (bara efter) Menyn "+ Lägg till widget". Klocka (analog) och Kvar till … finns redan och är därför avstängda; Nedräkning får finnas flera gånger |

Morgonskärmens panel är alltid mörk, även i ljust tema. Det gäller också på
`main`.

## Avvägningar

- **Status under namnet:** status som plats och storlek, skyltens nivå och
  mätarens läge står på en liten rad under namnet, som "Eleverna ser: …" i
  "Att göra". Morgonpanelen är 22rem bred, så namn, status, tid och tre
  knappar ryms inte på en rad utan att namnet kortas av. Timerns tid står
  kvar till höger på raden.
- **Nedräkning med rubrik på Morgonskärmen:** raden visar bara ”Läsning”, och
  typen står på raden under ("Nedräkning · nere höger · M"). Med typen på
  samma rad blev det "Nedräkning ”L…". Skärmläsare och verktygstips får
  alltid hela namnet, "Nedräkning ”Läsning”".
- **Typnamn:** typen heter "Kvar till klockslag" på Morgonskärmen, som i
  issuen. Tidigare hette den "Nedräkning till klockslag".

## Kontrollerat i webbläsaren

Kontrollerat med headless Chromium via CDP, i båda vyerna:

- Menyn går att styra med tangentbordet: Enter öppnar den, ↓ ↑ flyttar och
  Esc stänger med fokus tillbaka på knappen. Enter på ett avstängt val låter
  menyn stå kvar öppen.
- En ny widget öppnas utfälld, med fokus på dess ⚙.
- ⚙ fäller ut en widget åt gången, och fokus stannar på ⚙.
- ✕ ger texten "… borttagen. Ångra" och flyttar fokus till nästa rads ⚙.
  Ångra lägger tillbaka widgeten på samma plats.
- ▶ startar, ⏸ pausar och Återställ (under ⚙) går tillbaka till 8:00.
  Panelen har ingen Start-knapp.
- Vid gränsen blir knappen avstängd, med texten "Högst 3 i lektionen"
  respektive "Alla hörn är upptagna".
- Elevskärmen har ingen widgetpanel.
- Panelen utanför Widgets är oförändrad, kontrollerat med ett fingeravtryck
  av position, storlek, typsnitt och färger för varje element, före och
  efter, i 1920 och 1280. Den enda skillnaden var bakgrundsbildens namn, som
  slumpas vid varje laddning.
