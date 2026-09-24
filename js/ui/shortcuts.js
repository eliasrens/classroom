/**
 * GLOBALA TANGENTGENVÄGAR (Läge 5).
 *
 * De genvägar som gäller i hela lärarvyn — resten bor där de hör hemma
 * (timer i trafikljus.js, snabbanteckning i quick-note.js, elevtangenter
 * i elever.js). Genvägslistan visas under "?" (js/ui/help.js).
 *
 *   1–7   byt läge (i menyordning)
 *   E     öppna/fokusera elevskärmen
 *   ?     visa genvägslistan
 *
 * Spärrar:
 *  - Aldrig i elevvyn (fönstret som visar #/elev/…).
 *  - Aldrig medan man skriver i ett textfält, och aldrig med Ctrl/Meta/Alt.
 *    (Fokus på kryssruta/radioknapp/knapp/lista stänger INTE av dem —
 *    se typingInField.)
 *  - Inte medan snabbanteckningen eller hjälprutan är öppen (de äger
 *    tangenterna då).
 *  - 1–7 och E är AVSTÄNGDA i Elevlistans Registrera-flik: där är
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

/**
 * Input-typer där man faktiskt SKRIVER tecken. Kryssrutor, radioknappar,
 * reglage, knappar och färg/fil-väljare är inte "skrivfält": efter ett
 * klick på dem ligger fokus kvar där, och tidigare tystnade 1–5 då helt
 * (issue #25 — "ibland går det inte att byta flik").
 */
const TEXT_INPUT_TYPES = new Set([
  "", "text", "search", "email", "url", "tel", "password", "number",
  "date", "time", "datetime-local", "month", "week",
]);

/** Skriver användaren i ett fält just nu? Då äger fältet tangenterna. */
export function typingInField(t) {
  if (!t || t.nodeType !== 1) return false;
  if (t.isContentEditable || t.matches?.("textarea")) return true;
  if (t.matches?.("input")) return TEXT_INPUT_TYPES.has((t.getAttribute("type") ?? "").toLowerCase());
  // <select> räknas INTE: en stängd lista med fokus (t.ex. klassväljaren
  // efter ett klassbyte) svalde annars 1–5 — och "4" hoppade dessutom
  // till klassen "4A"/"4B" via inbyggd typ-sökning i stället för att
  // byta läge. Genvägen vinner och preventDefault stoppar typ-sökningen.
  return false;
}

export function initShortcuts({ store, openStudentWindow, openHelp }) {
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
    // enskilda tecken — lämna 1–7 och E därhän så inget krockar.
    if (inRegisterTab(store)) return;

    // 1–7: byt läge i menyordning.
    if (/^[1-7]$/.test(e.key)) {
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
