/**
 * GLOBALA TANGENTGENVÄGAR (Läge 5).
 *
 * De genvägar som gäller i hela lärarvyn — resten bor där de hör hemma
 * (timer i trafikljus.js, snabbanteckning i quick-note.js, elevtangenter
 * i elever.js). Genvägslistan visas under "?" (js/ui/help.js).
 *
 *   1–5   byt läge (i menyordning)
 *   E     öppna/fokusera elevskärmen
 *   ?     visa genvägslistan
 *
 * Spärrar:
 *  - Aldrig i elevvyn (fönstret som visar #/elev/…).
 *  - Aldrig medan man skriver i ett fält, och aldrig med Ctrl/Meta/Alt.
 *  - Inte medan snabbanteckningen eller hjälprutan är öppen (de äger
 *    tangenterna då).
 *  - 1–5 och E är AVSTÄNGDA i Elevlistans Registrera-flik: där är
 *    enskilda bokstäver/siffror elevernas egna snabbtangenter, så vi
 *    krockar aldrig med dem.
 */

import { MODES } from "../modes/registry.js";

/** Står Elevlistan i Registrera-fliken? Då äger elevtangenterna tecknen. */
function inRegisterTab(store) {
  if (store.get().modeId !== "elever") return false;
  try { return (sessionStorage.getItem("classroom:elever:tab") ?? "registrera") === "registrera"; }
  catch { return true; }
}

export function initShortcuts({ store, openStudentWindow, openHelp }) {
  function typingInField(t) {
    return t && (t.matches?.("input, textarea, select") || t.isContentEditable);
  }
  const dialogOpen = () =>
    document.querySelector(".quick-note[data-open], .help[data-open]") != null;

  function onKeydown(e) {
    if (store.get().view !== "teacher") return;      // aldrig på elevskärmen
    if (typingInField(e.target)) return;

    // "?" (Shift+/) — visa genvägslistan. Tillåts även i Elevlistan.
    if (e.key === "?") { e.preventDefault(); openHelp(); return; }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (dialogOpen()) return;

    // I Elevlistans Registrera-flik äger elevernas snabbtangenter
    // enskilda tecken — lämna 1–5 och E därhän så inget krockar.
    if (inRegisterTab(store)) return;

    // 1–5: byt läge i menyordning.
    if (/^[1-5]$/.test(e.key)) {
      const mode = MODES[Number(e.key) - 1];
      if (mode) {
        e.preventDefault();
        location.hash = `#/${mode.id}`;
      }
      return;
    }

    // E: öppna/fokusera elevskärmen.
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      openStudentWindow?.();
    }
  }

  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
