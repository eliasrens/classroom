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
 *
 * NAVIGERINGEN FÅR ALDRIG LÅSA SIG (issue #25). Monteringar körs i en
 * serialiserad kedja; ett enda läge vars mount/unmount aldrig resolvar
 * (väntar på nät/data som aldrig kommer) eller kraschar fick tidigare
 * hela kedjan att stå still — inga fler flikbyten gick igenom. Därför:
 *  - mount, unmount och klassuppslaget har en tidsgräns (STEP_TIMEOUT_MS);
 *    ett läge som inte blir klart i tid loggas och routern går vidare,
 *  - kedjan fångar ALLA fel, så ett oväntat kast aldrig lämnar den i
 *    avvisat tillstånd (en avvisad kedja hoppar över alla senare steg),
 *  - varje montering får en egen behållare i <main>: ett övergivet
 *    (för sent färdigt) läge skriver då in i en frånkopplad nod och kan
 *    aldrig skriva över det läge som visas nu.
 */

import { getMode, DEFAULT_MODE_ID, isStudentMode } from "./modes/registry.js";

/** Maxtid per livscykelsteg. Ett friskt läge monteras på millisekunder. */
export const STEP_TIMEOUT_MS = 3000;

const TIMED_OUT = Symbol("timeout");

/** Vänta på `work` (promise eller värde), högst `ms` — annars TIMED_OUT. */
function withTimeout(work, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(work),
    new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export function createRouter({ store, data, viewEl, sync, stepTimeoutMs = STEP_TIMEOUT_MS }) {
  let current = null;    // { mode, view, slot } som är monterat just nu
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
   * Kör ett livscykelsteg med tidsgräns och felfångst. Returnerar true om
   * steget blev klart, false om det kraschade eller överskred tidsgränsen
   * (då loggas det, och routern går vidare ändå).
   */
  async function step(label, fn) {
    try {
      const result = await withTimeout(fn(), stepTimeoutMs);
      if (result === TIMED_OUT) {
        console.error(`[router] ${label} blev inte klar inom ${stepTimeoutMs} ms — går vidare.`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[router] ${label} kraschade:`, err);
      return false;
    }
  }

  /**
   * Begär en montering av aktuellt store-tillstånd. Serialiseras så att
   * två snabba tillståndsbyten (t.ex. vid kallstart: default-läge →
   * hash-parsat läge) ALDRIG kör mount/unmount om vartannat. En begäran
   * som hunnit bli inaktuell (mountSeq har växt) hoppas över — annars kan
   * ett övergivet läges mount/crash skriva över det aktuella lägets vy.
   * Kedjan kan aldrig bli avvisad: doMount fångar sina egna fel och
   * .catch nedan är sista skyddsnätet.
   */
  function mountCurrent() {
    const seq = ++mountSeq;
    mounting = mounting
      .then(() => doMount(seq))
      .catch((err) => console.error("[router] oväntat fel i monteringskedjan:", err));
    return mounting;
  }

  async function doMount(seq) {
    if (seq !== mountSeq) return; // redan inaktuell innan vi ens började

    if (current) {
      const leaving = current;
      current = null;
      await step(`unmount av "${leaving.mode.id}"`, () => leaving.mode.unmount());
      leaving.slot.remove();
    }
    if (seq !== mountSeq) return; // ett nyare läge har begärts under unmount

    const { modeId, view, classId } = store.get();
    const mode = getMode(modeId) ?? getMode(DEFAULT_MODE_ID);

    let activeClass = null;
    if (classId) {
      try {
        const cls = await withTimeout(data.get("classes", classId), stepTimeoutMs);
        if (cls === TIMED_OUT) console.error("[router] klassuppslaget hängde — monterar utan klass.");
        else activeClass = cls ?? null;
      } catch (err) {
        console.error("[router] klassuppslaget kraschade — monterar utan klass:", err);
      }
    }
    if (seq !== mountSeq) return; // ett nyare läge har begärts under datahämtning

    document.documentElement.dataset.theme = view;
    // Egen behållare per montering (display: contents → layouten är som
    // om läget renderats direkt i <main>). Kommer en hängande mount
    // tillbaka för sent skriver den i en frånkopplad nod — ofarligt.
    viewEl.innerHTML = "";
    const slot = document.createElement("div");
    slot.className = "view__slot";
    slot.dataset.mode = mode.id;
    viewEl.append(slot);

    // Registreras FÖRE mount: även ett läge som hänger/kraschar halvvägs
    // unmountas vid nästa byte, så det som hann startas städas bort.
    current = { mode, view, slot };
    const ctx = { store, data, view, activeClass, sync };
    const ok = await step(`mount av "${mode.id}"`, () => mode.mount(slot, ctx));

    if (!ok && seq === mountSeq && current?.slot === slot) {
      slot.innerHTML = `<div class="mode-placeholder"><h2>Hoppsan!</h2>
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

    /** Resolvar när alla hittills begärda monteringar är klara (för test/diagnostik). */
    settled: () => mounting,
  };
}
