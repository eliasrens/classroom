# Issue #87 — redigera uppgifter direkt i morgonpanelen

Headless Chrome, lokalt läge (apiKey överstyrd till "FYLL_I…" bara under testet), testklass TEST-87.

| Fil | Visar |
|---|---|
| fore-1920-panel.png, fore-1280-panel.png | Före: bara namnet syns, pennan öppnade `prompt()` |
| efter-1920-panel.png, efter-1280-panel.png | Efter: "Eleverna ser: …" under färdiga uppgifter och Starten |
| efter-1280-redigerar-fast.png | Pennan på en färdig uppgift: textfältet direkt i raden (fokus, markerad text) |
| efter-1280-panel-andrad.png | Ändrad elevtext med länken "Återställ" |
| efter-elevskarm-ny-text.png | Elevskärmen (eget fönster) visar den nya texten |
| efter-1280-tom-text-hint.png | Tom text + Enter: diskret hint, inget sparas |
| efter-1920-redigerar-egen.png | Egen uppgift: namnet redigeras i raden |

## Kontroller (alla gröna)
- Enter sparar; panel, kort och elevskärm visar den nya texten.
- Återställ ger tillbaka "Läs tyst i bänkboken" (ur `seedTasks()`), och länken försvinner.
- Esc och ✕ avbryter utan att spara. ✕ tar inte fokus från fältet (pointerdown), så blur-sparandet hinner inte köra först.
- Klick utanför sparar. Med tom text avbryter det i stället.
- Tom text + Enter/✓: fältet stannar kvar, `aria-invalid`, hinten "Texten kan inte vara tom." visas.
- Egen uppgift: `label` och `studentText` uppdateras båda.
- `window.prompt` och `window.confirm` spionerade: 0 anrop.
- Ingen sidledsscroll: panel 351/351 (1920), 314/314 (1280); lista 321/321, 284/284.
