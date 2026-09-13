/**
 * ROUTER — hashbaserad (fungerar på GitHub Pages utan serverkonfig).
 *
 * Rutter:
 *   #/<modeId>        lärarvy för ett läge      t.ex. #/morgon
 *   #/elev/<modeId>   elevvy (projektor/elevskärm) för samma läge
 *
 * Routern äger livscykeln: den unmountar aktivt läge och mountar
 * nästa enligt MODULKONTRAKTET. Byte av klass remountar aktivt läge
 * (kontraktets regel — lägen slipper egen klassbyteslogik).
 */

import { getMode, DEFAULT_MODE_ID, isStudentMode } from "./modes/registry.js";

export function createRouter({ store, data, viewEl, sync }) {
  let current = null;    // { mode, view } som är monterat just nu
  let mountSeq = 0;      // växer vid varje monteringsbegäran
  let mounting = Promise.resolve(); // serialiserar monteringar (aldrig överlappande)

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const isStudent = parts[0] === "elev";
    let modeId = (isStudent ? parts[1] : parts[0]) || DEFAULT_MODE_ID;
    if (!getMode(modeId)) modeId = DEFAULT_MODE_ID;
    // SPÄRR: elevvyn kan bara visa elevlägen — lärarlägen (elevlista,
    // översikt, noteringar) får aldrig renderas på projektorn.
    if (isStudent && !isStudentMode(modeId)) modeId = DEFAULT_MODE_ID;
    return { view: isStudent ? "student" : "teacher", modeId };
  }

  /**
   * Begär en montering av aktuellt store-tillstånd. Serialiseras så att
   * två snabba tillståndsbyten (t.ex. vid kallstart: default-läge →
   * hash-parsat läge) ALDRIG kör mount/unmount om vartannat. En begäran
   * som hunnit bli inaktuell (mountSeq har växt) hoppas över — annars kan
   * ett övergivet läges mount/crash skriva över det aktuella lägets vy.
   */
  function mountCurrent() {
    const seq = ++mountSeq;
    mounting = mounting.then(() => doMount(seq));
    return mounting;
  }

  async function doMount(seq) {
    if (seq !== mountSeq) return; // redan inaktuell innan vi ens började

    const { modeId, view } = store.get();
    const mode = getMode(modeId);

    if (current) {
      try { await current.mode.unmount(); }
      catch (err) { console.warn(`[router] unmount av "${current.mode.id}":`, err); }
    }
    if (seq !== mountSeq) return; // ett nyare läge har begärts under unmount

    document.documentElement.dataset.theme = view;
    viewEl.innerHTML = "";

    const { classId } = store.get();
    const activeClass = classId ? await data.get("classes", classId) : null;
    if (seq !== mountSeq) return; // ett nyare läge har begärts under datahämtning
    const ctx = { store, data, view, activeClass, sync };

    current = { mode, view };
    try {
      await mode.mount(viewEl, ctx);
    } catch (err) {
      console.error(`[router] mount av "${mode.id}" kraschade:`, err);
      if (seq === mountSeq) {
        viewEl.innerHTML = `<div class="mode-placeholder"><h2>Hoppsan!</h2>
          <p>Läget kunde inte laddas. Prova att byta läge och tillbaka.</p></div>`;
      }
    }
  }

  function onHashChange() {
    const { view, modeId } = parseHash();
    store.set({ view, modeId });
  }

  return {
    start() {
      // Store är sanningen; hash → store → (re)mount.
      store.subscribe(["modeId", "view", "classId"], () => void mountCurrent());
      window.addEventListener("hashchange", onHashChange);
      if (!location.hash) history.replaceState(null, "", `#/${DEFAULT_MODE_ID}`);
      onHashChange();
    },

    /** Navigera programatiskt, t.ex. från lägesmenyn. */
    navigate(modeId, { view } = {}) {
      const v = view ?? store.get().view;
      location.hash = v === "student" ? `#/elev/${modeId}` : `#/${modeId}`;
    },
  };
}
