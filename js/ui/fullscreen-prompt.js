/**
 * HELSKÄRMSLAGER FÖR ELEVSKÄRMEN (projektorn).
 *
 * Elevfönstret öppnas med ?autofs=1 för presentation, men
 * requestFullscreen() kräver en TRANSIENT ANVÄNDARGEST i just det
 * fönstret — klick-gesten från "Öppna elevskärm" följer inte med hit,
 * så ett auto-anrop avvisas tyst (fönster i skärmstorlek med ram, inte
 * äkta helskärm). Därför visar vi ett stort, tydligt ett-kliks lager:
 * ett riktigt klick DÄR ger en giltig gest → äkta helskärm på skärm 2.
 *
 * - Döljs så fort document.fullscreenElement är satt.
 * - Kommer tillbaka via 'fullscreenchange' om läraren lämnar helskärm.
 * - Dubbelklick-för-helskärm och all skärm-positionering (screens.js)
 *   finns kvar orörda. Aldrig i lärarvyn. Try/catch — inget får krascha.
 */

import { icon } from "../lib/icons.js";
import { enterFullscreenOnProjector } from "../lib/screens.js";

export function initFullscreenPrompt() {
  let el = null;

  function build() {
    if (el) return el;
    el = document.createElement("button");
    el.type = "button";
    el.className = "fs-prompt"; // monteras bara i elevfönstret; se villkoret i app.js
    el.setAttribute("aria-label", "Klicka för helskärm på projektorn");
    el.innerHTML = `
      <span class="fs-prompt__inner">
        ${icon("expand", { size: 56, strokeWidth: 1.4 })}
        <span class="fs-prompt__title">Klicka för helskärm på projektorn</span>
        <span class="fs-prompt__hint">Skärmen visas i äkta helskärm. Tryck Esc för att lämna.</span>
      </span>`;
    el.addEventListener("click", () => {
      // Äkta gest → begär helskärm på projektorn. Lyckas den inte gör
      // enterFullscreenOnProjector inget (dubbelklick finns kvar).
      void enterFullscreenOnProjector().catch(() => { /* helskärm är en bonus */ });
    });
    try { document.body.appendChild(el); } catch { /* ignoreras */ }
    return el;
  }

  function update() {
    try {
      const node = build();
      node.hidden = !!document.fullscreenElement;
    } catch { /* inget får krascha elevskärmen */ }
  }

  update();
  document.addEventListener("fullscreenchange", update);
}
