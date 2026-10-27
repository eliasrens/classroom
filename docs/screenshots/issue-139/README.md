# Issue #139: rubriken "Efter rasten" eller "Efter pausen"

Lokalt läge (Firebase-konfigurationen ersatt med platshållaren av en lokal
testserver, inget moln) med den påhittade klassen `TEST-139`. Planeringen har
Vad ("Bråk") och "Efter rasten"-rutan med "Välj mellan: - Läsa - Rita",
ingen starttid (timern står still på 10:00).

| Fil | Visar |
|---|---|
| `larare-rasten.png` | Lärarvyn 1600×1000 innan valet: tavlan visar "EFTER RASTEN", sammanfattningen "Vad, Efter rasten visas" |
| `larare-pausen-redigering.png` | "Efter pausen" valt i Rubrik-väljaren: kryssrutan, tavlan och sammanfattningen säger "Efter pausen" |
| `elev-pausen.png` | Elevskärmen 1280×720 efter omladdning av lärarvyn: "EFTER PAUSEN" (valet sparat) |
| `elev-rasten-efter-byte.png` | Elevskärmen efter att läraren bytt tillbaka till "Efter rasten" — uppdaterad direkt, utan omladdning |

## Tillägg: timer på/av

Samma planering, starttid 20:14 och 10 minuter — tiden var ute (klockan 20:45).

| Fil | Visar |
|---|---|
| `larare-utan-timer.png` | "Visa timer" urkryssad: Minuter dolt; rutan utan klocka, nedräkning och "+1 min", bara "Dölj nu". Rutan står kvar fast tiden är ute och kryssrutan bockas inte ur (kontrollerat efter flera sekunder) |
| `elev-utan-timer.png` | Elevskärmen 1280×720 samtidigt: rutan utan timer, etiketten på en rad (`--lb-break-scale` 0.94) |
| `elev-timer-pa-igen.png` | Timern påslagen igen från lärarvyn: nedräkningen startar om från nu (9:54) — elevskärmen uppdaterad direkt, utan omladdning |

"Dölj nu" med timern av: rutan försvinner och kryssrutan bockas ur, även på elevskärmen.
