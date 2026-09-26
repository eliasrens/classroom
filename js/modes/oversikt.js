/**
 * ÖVERSIKT — lärarläge med flikar (issue #45: Översikt + Statistik ihop).
 * ENDAST LÄRARVY.
 *
 *   Idag / denna vecka   #/oversikt/idag           startvyn (js/modes/oversikt/idag.js)
 *   Veckor / arkiv       #/oversikt/veckor         veckoarkiv, veckomål, trender (veckor.js)
 *   Klassåtgärder        #/oversikt/atgarder       lärarnas delade logg (#34, atgarder.js)
 *   Inställningar och    #/oversikt/installningar  namnvisning, gallring (#32),
 *   dataskydd                                      "Radera all data" (installningar.js)
 *
 * Fliken står i adressen (routern lägger den i store.modeSub), så den går
 * att länka till, bakåtknappen fungerar och gamla #/statistik-länkar leder
 * rätt (MODE_ALIASES i registry.js). Flikbyte remountar inte läget — bara
 * fliken byts. Utan flik i adressen visas den senast använda.
 *
 * INTEGRITETSSPÄRR: översikten (klassdata, noteringsinställningar) får
 * ALDRIG nå elevskärmen. Läget står i lärargruppen och därmed inte i
 * STUDENT_MODE_IDS, så routern monterar det aldrig i elevvyn — och skulle
 * det ändå ske renderas en neutral skärm utan att någon flik monteras.
 */

import { icon } from "../lib/icons.js";
import { mountIdag } from "./oversikt/idag.js";
import { mountVeckor } from "./oversikt/veckor.js";
import { mountAtgarder } from "./oversikt/atgarder.js";
import { mountInstallningar } from "./oversikt/installningar.js";

export const OVERSIKT_TABS = [
  { id: "idag", long: "Idag / denna vecka", icon: "calendar", mount: mountIdag },
  { id: "veckor", long: "Veckor / arkiv", icon: "chart", mount: mountVeckor },
  { id: "atgarder", long: "Klassåtgärder", icon: "bulb", mount: mountAtgarder },
  { id: "installningar", long: "Inställningar och dataskydd", icon: "shield", mount: mountInstallningar },
];

const TAB_KEY = "classroom:oversikt:tab";
const tabHref = (id) => `#/oversikt/${id}`;
const validTab = (id) => OVERSIKT_TABS.some((t) => t.id === id);

function rememberedTab() {
  try {
    const t = sessionStorage.getItem(TAB_KEY);
    return validTab(t) ? t : "idag";
  } catch { return "idag"; }
}

export default {
  id: "oversikt",
  title: "Översikt",
  icon: "layout",

  async mount(el, ctx) {
    this._offs = [];

    // ---- SPÄRR: aldrig klassdata på elevskärmen ----
    if (ctx.view !== "teacher") {
      el.innerHTML = `
        <div class="mode-placeholder">
          <h1>Klassrumsverktyget</h1>
          <p>Översikten finns bara på lärarens skärm.</p>
        </div>`;
      return;
    }

    const { store } = ctx;
    el.innerHTML = `
      <div class="oversikt">
        <div class="ov-tabs" role="tablist" aria-label="Översikt">
          ${OVERSIKT_TABS.map((t) => `
            <a class="ov-tab" role="tab" id="ov-tab-${t.id}" href="${tabHref(t.id)}" data-tab="${t.id}"
              aria-controls="ov-panel" title="${t.long}">${icon(t.icon)}<span>${t.long}</span></a>`).join("")}
        </div>
        <div class="ov-panel" id="ov-panel" role="tabpanel"></div>
      </div>`;
    const tabsEl = el.querySelector(".ov-tabs");
    const panelEl = el.querySelector(".ov-panel");

    let current = null;      // aktiv flik-id
    let panelOffs = [];      // städning för aktiv flik

    function unmountPanel() {
      for (const off of panelOffs) { try { off(); } catch { /* noop */ } }
      panelOffs = [];
    }

    function show(id) {
      if (!validTab(id)) id = rememberedTab();
      // Adressen visar alltid fliken (utan ny historikpost).
      if (location.hash !== tabHref(id)) history.replaceState(null, "", tabHref(id));
      if (id === current) return;
      current = id;
      try { sessionStorage.setItem(TAB_KEY, id); } catch { /* ok */ }

      for (const a of tabsEl.querySelectorAll("[data-tab]")) {
        const on = a.dataset.tab === id;
        a.setAttribute("aria-selected", String(on));
        a.tabIndex = on ? 0 : -1;
      }
      panelEl.setAttribute("aria-labelledby", `ov-tab-${id}`);

      unmountPanel();
      // Ny behållare per flik: flikarnas delegerade lyssnare följer med ut.
      panelEl.innerHTML = "";
      const slot = document.createElement("div");
      slot.className = `ov-panel__slot ov-panel__slot--${id}`;
      panelEl.append(slot);
      const tab = OVERSIKT_TABS.find((t) => t.id === id);
      try {
        panelOffs = tab.mount(slot, ctx, { tabHref }) ?? [];
      } catch (err) {
        console.error(`[oversikt] fliken "${id}" kunde inte laddas:`, err);
        slot.innerHTML = `<div class="mode-placeholder"><h2>Hoppsan!</h2>
          <p>Fliken kunde inte laddas. Prova att byta flik och tillbaka.</p></div>`;
      }
    }

    // Piltangenter mellan flikarna (WAI-ARIA Tabs, automatisk aktivering).
    tabsEl.addEventListener("keydown", (e) => {
      const tabs = [...tabsEl.querySelectorAll("[data-tab]")];
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      else if (e.key === " ") { e.preventDefault(); tabs[i].click(); return; }
      if (!next) return;
      e.preventDefault();
      next.focus();
      next.click();
    });

    // Fliken följer adressen: #/oversikt/<flik> → store.modeSub (routern).
    // På väg till ett annat läge ändras modeSub innan routern hunnit
    // unmounta oss — rör då varken flik eller adress.
    this._offs.push(store.subscribe(["modeSub"], ({ modeSub, modeId }) => {
      if (modeId === "oversikt") show(modeSub);
    }));
    this._offs.push(unmountPanel);
  },

  async unmount() {
    for (const off of this._offs ?? []) { try { off(); } catch { /* noop */ } }
    this._offs = [];
  },
};
