/**
 * ELEVSKÄRMSPANELEN — lärarvyns hörna för allt kring elevskärmen:
 *
 *  - indikator: är elevskärmen ÖPPEN eller STÄNGD (store.studentOpen,
 *    matas av presence-vakten i sync.js)
 *  - liten live-förhandsvisning av exakt det eleverna ser: en iframe
 *    som kör appens elevvy med ?preview — den följer lägesbyten via
 *    sync-kanalen precis som en riktig elevskärm, men är tyst i
 *    presence-protokollet och räknas aldrig som öppen skärm
 *  - "Öppna elevskärm" (nytt fönster → projektorn)
 *  - "Helskärm här" — ENSKÄRMSLÄGE: samma fönster växlar till elevvy
 *    i helskärm; Esc/avslutad helskärm tar läraren tillbaka
 *
 * Panelen renderas bara i lärarvyn (döljs helt när view = student).
 *
 * Den viker undan för element märkta `data-dock-avoid` (Morgonskärmens
 * hörnwidgets, issue #120) — se js/lib/dock.js.
 */

import { icon } from "../lib/icons.js";
import { DEFAULT_MODE_ID, isStudentMode, getMode } from "../modes/registry.js";
import { isExactlyPresented, presentedLabel } from "../lib/present.js";
import { SINGLESCREEN_RETURN_KEY } from "../sync.js";
import { DOCK_AVOID_ATTR, DOCK_BLOCK_ATTR, DOCK_WALL_ATTR, dockPlace, onDockLayoutRequest, publishDockCovered } from "../lib/dock.js";

const COLLAPSED_KEY = "classroom:ui:studentPanelCollapsed";
const RETURN_KEY = SINGLESCREEN_RETURN_KEY; // sessionStorage: lärarens läge att återvända till

const readReturnMode = () => { try { return sessionStorage.getItem(RETURN_KEY); } catch { return null; } };
const writeReturnMode = (v) => {
  try { v == null ? sessionStorage.removeItem(RETURN_KEY) : sessionStorage.setItem(RETURN_KEY, v); }
  catch { /* lagring otillgänglig — Esc-vägen funkar ändå via helskärmsläget */ }
};

export function initStudentPanel({ store, openStudentWindow, present }) {
  const el = document.createElement("aside");
  el.className = "student-panel";
  el.setAttribute("aria-label", "Elevskärm");
  el.innerHTML = `
    <header class="student-panel__head">
      <span class="student-panel__status" data-open="false">
        ${icon("monitor")}<span class="student-panel__statustext">Elevskärm stängd</span>
      </span>
      <button class="btn btn--ghost btn--icon student-panel__toggle"
        title="Fäll ihop/ut förhandsvisningen" aria-expanded="true"></button>
    </header>
    <div class="student-panel__body">
      <div class="student-panel__frame" title="Förhandsvisning — det eleverna ser just nu">
        <iframe class="student-panel__iframe" title="Förhandsvisning av elevskärmen"
          aria-hidden="true" tabindex="-1"></iframe>
      </div>
      <p class="student-panel__showing" aria-live="polite">
        Eleverna ser: <strong class="student-panel__shownmode">—</strong>
      </p>
      <div class="student-panel__actions">
        <button class="btn btn--primary student-panel__present" data-active="false">
          ${icon("monitor")}<span class="student-panel__presentlabel">Visa på elevskärm</span></button>
      </div>
      <div class="student-panel__actions">
        <button class="btn student-panel__open">${icon("monitor")}<span>Öppna elevskärm</span></button>
        <button class="btn btn--ghost student-panel__fullscreen"
          title="Enskärmsläge: visa elevskärmen i helskärm i detta fönster">
          ${icon("expand")}<span>Helskärm här</span></button>
      </div>
    </div>`;
  document.getElementById("app").appendChild(el);

  const statusEl = el.querySelector(".student-panel__status");
  const statusText = el.querySelector(".student-panel__statustext");
  const toggleBtn = el.querySelector(".student-panel__toggle");
  const iframe = el.querySelector(".student-panel__iframe");
  const shownModeEl = el.querySelector(".student-panel__shownmode");
  const presentBtn = el.querySelector(".student-panel__present");
  const presentLabel = el.querySelector(".student-panel__presentlabel");

  // ---- Indikator: öppen/stängd ----

  store.subscribe(["studentOpen"], ({ studentOpen }) => {
    statusEl.dataset.open = String(!!studentOpen);
    statusText.textContent = studentOpen ? "Elevskärm öppen" : "Elevskärm stängd";
  });

  // ---- "Visa på elevskärm" + indikator för utskickat läge ----
  //
  // Skickar ut EXAKT det läraren tittar på (issue #88): läget OCH — om
  // läget har "flera saker" — den planering/karta som är öppen (lägets
  // onPresent). Knappen är GRÖN ("Visas för eleverna") bara när eleverna
  // ser exakt samma sak (samma läge och samma planering/karta, se
  // js/lib/present.js); annars guld. Indikatorn visar det utskickade —
  // skilt från lärarens egen flik.

  presentBtn.addEventListener("click", async () => {
    const { modeId } = store.get();
    if (!isStudentMode(modeId)) return;
    // Lägets sak först (skrivs i datalagret/lokalt), sedan läget på
    // bussen — en elevskärm som byter läge läser då redan rätt sak.
    try { await getMode(modeId)?.onPresent?.(); }
    catch (err) { console.warn("[elevskärmspanelen] onPresent misslyckades:", err); }
    present(modeId);
  });

  store.subscribe(["modeId", "presentedMode", "presentSpot"], ({ modeId, presentedMode, presentSpot }) => {
    const shown = presentedMode ? getMode(presentedMode) : null;
    shownModeEl.textContent = shown
      ? presentedLabel({ presentedMode, modeTitle: shown.title, spot: presentSpot })
      : "—";

    const canPresent = isStudentMode(modeId);
    const exact = canPresent && isExactlyPresented({ modeId, presentedMode, spot: presentSpot });
    presentBtn.disabled = !canPresent;
    presentBtn.dataset.active = String(exact);
    if (!canPresent) {
      presentLabel.textContent = "Visa på elevskärm";
      presentBtn.title = "Det här läget kan inte visas för eleverna";
    } else if (exact) {
      presentLabel.textContent = "Visas för eleverna";
      presentBtn.title = "Eleverna ser exakt det du tittar på";
    } else {
      presentLabel.textContent = "Visa på elevskärm";
      presentBtn.title = "Skicka ut exakt det du tittar på till elevskärmen";
    }
  });

  // ---- Förhandsvisning (laddas bara när panelen är utfälld) ----

  // Förhandsvisningen speglar det UTSKICKADE läget (det eleverna ser),
  // inte lärarens egen flik. Efter initial laddning följer iframen
  // vidare present-meddelanden live via sync-bussen (den är en riktig,
  // men tyst, elevskärm) — därför sätts src bara när den är tom.
  function previewUrl() {
    const { presentedMode } = store.get();
    const target = isStudentMode(presentedMode) ? presentedMode : DEFAULT_MODE_ID;
    return `${location.pathname}?preview=1#/elev/${target}`;
  }

  // Två src-tilldelningar i samma task kan lämna iframen fast på
  // about:blank (Chromium). Därför: debounce + stäm av mot iframens
  // FAKTISKA adress, inte src-attributet.
  let previewTimer = null;
  function updatePreview() {
    const wantLoaded = !el.hidden && el.dataset.collapsed !== "true";
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      let actual = null;
      try { actual = iframe.contentWindow?.location.href; } catch { /* okänd → behandla som blank */ }
      const isBlank = !actual || actual === "about:blank";
      if (wantLoaded && isBlank) iframe.src = previewUrl();
      else if (!wantLoaded && !isBlank) iframe.src = "about:blank";
    }, 60);
  }

  function setCollapsed(collapsed) {
    el.dataset.collapsed = String(collapsed);
    toggleBtn.setAttribute("aria-expanded", String(!collapsed));
    toggleBtn.innerHTML = icon(collapsed ? "chevron-up" : "chevron-down");
    // Ihopfälld panel ska inte kosta en hel app-instans i bakgrunden.
    updatePreview();
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : ""); } catch { /* ok */ }
  }

  let startCollapsed = false;
  try { startCollapsed = localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { /* ok */ }
  setCollapsed(startCollapsed);

  toggleBtn.addEventListener("click", () => setCollapsed(el.dataset.collapsed !== "true"));

  // ---- Åtgärder ----

  el.querySelector(".student-panel__open").addEventListener("click", openStudentWindow);
  el.querySelector(".student-panel__fullscreen").addEventListener("click", enterSingleScreen);

  // ---- Vik undan för widgets (issue #120) ----
  //
  // En widget i hörnet nere till höger på Morgonskärmen ska synas även i
  // lärarvyn. Dockan förskjuts (transform, så den vanliga platsen går att
  // mäta mitt i en övergång) åt vänster eller uppåt, bort från allt märkt
  // DOCK_AVOID_ATTR (js/lib/dock.js). Inget annat flyttas: elevskärmen har
  // ingen docka och ritar samma sak.

  let placeFrame = 0;
  function requestPlace() {
    cancelAnimationFrame(placeFrame);
    placeFrame = requestAnimationFrame(placeDock);
  }

  const visible = (x) => !x.hidden && x.getClientRects().length > 0;
  const rects = (sel) => [...document.querySelectorAll(sel)].filter(visible);

  function placeDock() {
    const r = el.getBoundingClientRect();
    if (el.hidden || !r.width || !r.height) {
      el.style.removeProperty("--dock-x");
      el.style.removeProperty("--dock-y");
      el.dataset.moved = "false";
      publishDockCovered([]);
      return;
    }
    // Nuvarande (ev. pågående) förskjutning → den vanliga platsen.
    let m = { m41: 0, m42: 0 };
    try { m = new DOMMatrixReadOnly(getComputedStyle(el).transform); } catch { /* ingen transform */ }
    const dock = { left: r.left - m.m41, right: r.right - m.m41, top: r.top - m.m42, bottom: r.bottom - m.m42 };
    const avoidEls = rects(`[${DOCK_AVOID_ATTR}]`);
    const topbar = document.getElementById("topbar");
    // Väggar (lärarpanelen) till vänster om dockan: den går aldrig in över dem.
    const walls = rects(`[${DOCK_WALL_ATTR}]`).map((x) => x.getBoundingClientRect()).filter((w) => w.right <= dock.left);
    const { dx, dy, covered } = dockPlace(dock, {
      avoid: avoidEls.map((x) => x.getBoundingClientRect()),
      block: rects(`[${DOCK_BLOCK_ATTR}]`).map((x) => x.getBoundingClientRect()),
      minTop: (topbar && visible(topbar) ? topbar.getBoundingClientRect().bottom : 0) + 8,
      minLeft: Math.max(0, ...walls.map((w) => w.right)) + 8,
      gap: 8,
    });
    const set = (name, v) => (v ? el.style.setProperty(name, `${Math.round(v)}px`) : el.style.removeProperty(name));
    set("--dock-x", dx);
    set("--dock-y", dy);
    el.dataset.moved = String(!!(dx || dy));
    publishDockCovered(covered.map((i) => avoidEls[i].getAttribute(DOCK_AVOID_ATTR)));
  }

  onDockLayoutRequest(requestPlace);
  window.addEventListener("resize", requestPlace);
  // Ut-/ihopfälld panel har en annan höjd.
  if (typeof ResizeObserver === "function") new ResizeObserver(requestPlace).observe(el);

  // Panelen (och dess iframe) finns bara i lärarvyn — hård spärr.
  store.subscribe(["view"], ({ view }) => {
    el.hidden = view !== "teacher";
    updatePreview();
    requestPlace();
  });

  // ---- Enskärmsläge ----

  function enterSingleScreen() {
    const { modeId } = store.get();
    writeReturnMode(modeId);
    location.hash = `#/elev/${isStudentMode(modeId) ? modeId : DEFAULT_MODE_ID}`;
    // Helskärm kräver användargest — vi är i ett klick, så det går.
    document.documentElement.requestFullscreen?.().catch(() => { /* elevvy utan helskärm duger */ });
  }

  function returnToTeacher() {
    const back = readReturnMode();
    if (back == null) return;
    writeReturnMode(null);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    location.hash = `#/${back || DEFAULT_MODE_ID}`;
  }

  // Läraren lämnar helskärm (Esc eller systemgest) → tillbaka till lärarvyn.
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && store.get().view === "student") returnToTeacher();
  });
  // Esc fungerar även om helskärmen aldrig gick igång.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && store.get().view === "student") returnToTeacher();
  });
}
