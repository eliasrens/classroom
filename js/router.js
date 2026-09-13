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

import { getMode, DEFAULT_MODE_ID } from "./modes/registry.js";

export function createRouter({ store, data, viewEl }) {
  let current = null; // { mode, view } som är monterat just nu

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const isStudent = parts[0] === "elev";
    const modeId = (isStudent ? parts[1] : parts[0]) || DEFAULT_MODE_ID;
    return {
      view: isStudent ? "student" : "teacher",
      modeId: getMode(modeId) ? modeId : DEFAULT_MODE_ID,
    };
  }

  async function mountCurrent() {
    const { modeId, view } = store.get();
    const mode = getMode(modeId);

    if (current) {
      try { await current.mode.unmount(); }
      catch (err) { console.warn(`[router] unmount av "${current.mode.id}":`, err); }
    }

    document.documentElement.dataset.theme = view;
    viewEl.innerHTML = "";

    const { classId } = store.get();
    const activeClass = classId ? await data.get("classes", classId) : null;
    const ctx = { store, data, view, activeClass };

    current = { mode, view };
    try {
      await mode.mount(viewEl, ctx);
    } catch (err) {
      console.error(`[router] mount av "${mode.id}" kraschade:`, err);
      viewEl.innerHTML = `<div class="mode-placeholder"><h2>Hoppsan!</h2>
        <p>Läget kunde inte laddas. Prova att byta läge och tillbaka.</p></div>`;
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
