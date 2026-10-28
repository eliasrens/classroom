# Issue #148: Timerbrickan, lugnare stapel

Lokalt läge (Firebase-konfigurationen ersatt med platshållaren av en lokal
testserver, inget moln) med den påhittade klassen `TEST-148`. "Före" är main
`bcb791e`, serverad från samma origin (`/before/`) så att planeringen är
densamma. Elevskärmen i 1920×1080. Samma planering i tre ämnen: Historia
(SO, gul), Matematik (blå) och Idrott & hälsa (mellanljus).

Ändring (bara inom `.lb-timer`, `css/modes/lektion.css`): stapeln är hälften
så tjock (0.12em → 0.06em), spåret currentColor 25 % → 18 %, fyllningen
currentColor → 60 %. Klockikonen har opacitet 0.75. Siffrorna har kvar
`textColor` som rubrikraden. Timerwidgetens stapel (`css/ui/widgets.css`) är
orörd.

| Bild | Vad |
|---|---|
| `1-{fore,efter}-elev-1920-historia-halvvags` | Historia: Efter rasten och stegtimern halvvägs. |
| `2-{fore,efter}-elev-1920-matematik-halvvags` | Matematik (mörkt ämne, vit text). |
| `3-{fore,efter}-elev-1920-idrott-halvvags` | Idrott & hälsa (mellanljust ämne). |
| `4-{fore,efter}-elev-1920-historia-fore-start` | Före start: "10:00", full stapel. |
| `5-efter-elev-1920-historia-steg-klart` | Stegtimern vid Klart: pulsen (`lb-step-pulse`, 1.8 s) fångad mitt i en period. |

Uppmätt (bild 4, före och efter): `--lb-scale` 1.000 och `--lb-steps-scale`
0.673 i båda; brickornas höjd 132.78 px och 49.02 px i båda.
