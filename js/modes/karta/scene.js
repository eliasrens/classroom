/**
 * TANKEKARTANS SCEN (issue #53) — molnet, kopplingarna och bubblorna.
 *
 * Samma rendering används i lärarens förhandsvisning (redigerbar), på
 * elevskärmen (bara visning) och i utskriften (statisk, på papperet).
 *
 * Scenen är en VIRTUELL yta (js/lib/karta-layout.js → sceneSize) med
 * värdytans bildformat, som skalas som helhet (transform) till värdytan.
 * Samma karta + samma bildformat ⇒ samma bild, i vilken storlek som helst.
 *
 * Bubblorna och molnet mäts i sin grundstorlek; layouten ger en skala
 * som läggs på som transform — ingen ommätning, inga avrundningsglapp.
 *
 * Rörelse: bubblorna glider till nya platser och nya bubblor växer fram
 * ur molnet — en gren ur sin förälder (requestAnimationFrame,
 * kopplingarna följer med). Av med prefers-reduced-motion.
 *
 * Grenar och färger (issue #59): en gren kopplas till sin förälder med
 * samma mjuka kurva, i grenens färg, och har något mindre text per nivå.
 * Molnets färg följer kartan (cloud = index i palette.js CLOUD_COLORS).
 * I lärarvyn MARKERAS en bubbla med ett klick (inget klick tar bort
 * något); den markerade har ett × och en tydlig ring. Elevskärmen och
 * utskriften har ingen markering.
 */

import { layoutMap, sceneSize, baseFontFor, linkPath, cloudPath } from "../../lib/karta-layout.js";
import { resolveColors, cloudColor } from "./palette.js";
import { depths, treeOrder } from "./tree.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const TITLE_FONT = 58;       // rubriken i molnet (virtuella px)
const TITLE_MAX_W = 560;     // rubriken bryts hit
const ANIM_MS = 520;
const DRAG_THRESHOLD = 6;    // px på skärmen innan ett klick blir en dragning

const reducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};
const ease = (t) => 1 - (1 - t) ** 3;

/**
 * @param {HTMLElement} host  ytan scenen fyller (storlek sätts av CSS eller anroparen)
 * @param {object} [opts]
 * @param {boolean} [opts.editable]   lärarvyn: redigerbar rubrik, ×, dra, dubbelklick
 * @param {boolean} [opts.animate]    mjuka rörelser (standard: på, utom med reduced motion)
 * @param {string}  [opts.titlePlaceholder]
 * @param {(text:string)=>void} [opts.onTitleInput]
 * @param {(text:string)=>void} [opts.onTitleCommit]
 * @param {(id:string)=>void} [opts.onRemove]
 * @param {(id:string|null, how:{focusInput?:boolean, via?:string})=>void} [opts.onSelect]
 * @param {(id:string, pin:{x:number,y:number})=>void} [opts.onMove]
 * @param {(id:string, text:string)=>void} [opts.onEdit]
 */
export function createScene(host, opts = {}) {
  const editable = !!opts.editable;
  const scene = document.createElement("div");
  scene.className = "kt-scene";
  const links = document.createElementNS(SVG_NS, "svg");
  links.setAttribute("class", "kt-links");
  links.setAttribute("aria-hidden", "true");
  const cloud = document.createElement("div");
  cloud.className = "kt-cloud";
  const cloudSvg = document.createElementNS(SVG_NS, "svg");
  cloudSvg.setAttribute("class", "kt-cloud__shape");
  cloudSvg.setAttribute("aria-hidden", "true");
  const cloudShape = document.createElementNS(SVG_NS, "path");
  cloudSvg.append(cloudShape);
  const title = document.createElement("div");
  title.className = "kt-title";
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "1");
  cloud.append(cloudSvg, title);
  const layer = document.createElement("div");
  layer.className = "kt-bubbles";
  scene.append(links, cloud, layer);
  host.append(scene);

  if (editable) {
    title.contentEditable = "plaintext-only";
    if (title.contentEditable !== "plaintext-only") title.contentEditable = "true";
    title.spellcheck = false;
    title.tabIndex = 0;
    title.dataset.placeholder = opts.titlePlaceholder ?? "Skriv en rubrik…";
    title.setAttribute("aria-label", "Rubrik");
  }

  /** @type {Map<string, {el:HTMLElement, text:HTMLElement, link:SVGPathElement, cur:{x:number,y:number,k:number}|null, to:any, from:any, w:number, h:number}>} */
  const nodes = new Map();
  let map = null;          // senast renderade kartan
  let dims = null;         // { w, h, scale } — virtuell scen + skalning till värdytan
  let center = { x: 0, y: 0 };
  let frame = 0;
  let animStart = 0;
  let destroyed = false;
  let dragging = null;     // { id, … } under en dragning
  let editingId = null;
  let selected = null;     // markerad bubbla (bara lärarvyn)
  let parentOf = new Map(); // id → förälderns id (grenar)

  const canAnimate = () => opts.animate !== false && !reducedMotion() && document.visibilityState === "visible";

  // ---- Mått ----

  /** Värdytans storlek → den virtuella scenens mått och skala. */
  function measureHost() {
    const r = host.getBoundingClientRect();
    const hw = opts.width ?? r.width;
    const hh = opts.height ?? r.height;
    if (!hw || !hh) return null;
    const { w, h } = sceneSize(hw / hh);
    return { w, h, scale: hw / w };
  }

  function applyDims() {
    scene.style.width = `${dims.w}px`;
    scene.style.height = `${dims.h}px`;
    scene.style.transform = `scale(${dims.scale})`;
    links.setAttribute("viewBox", `0 0 ${dims.w} ${dims.h}`);
    links.setAttribute("width", String(dims.w));
    links.setAttribute("height", String(dims.h));
    center = { x: dims.w / 2, y: dims.h / 2 };
  }

  // ---- Rendering ----

  function syncTitle(text) {
    if (editable && document.activeElement === title) return; // skriver just nu
    if (title.textContent !== text) title.textContent = text;
  }

  function makeNode(b) {
    const el = document.createElement("div");
    el.className = "kt-bubble";
    el.dataset.id = b.id;
    const text = document.createElement("span");
    text.className = "kt-bubble__text";
    el.append(text);
    if (editable) {
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      const x = document.createElement("button");
      x.type = "button";
      x.className = "kt-bubble__x";
      x.title = "Ta bort bubblan och dess grenar (kan ångras)";
      x.tabIndex = -1;
      x.setAttribute("aria-label", "Ta bort bubblan");
      x.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>`;
      el.append(x);
    }
    const link = document.createElementNS(SVG_NS, "path");
    link.setAttribute("class", "kt-link");
    return { el, text, link, cur: null, to: null, from: null, w: 0, h: 0 };
  }

  /**
   * Rita kartan. map = { title, cloud?, bubbles: [{ id, text, color, parentId?, pin? }] } eller null.
   * animate: false → allt hoppar direkt (första visningen, storleksbyte).
   */
  function render(next, { animate = true } = {}) {
    if (destroyed) return;
    map = next;
    const d = measureHost();
    if (!d) return;
    dims = d;
    applyDims();

    const bubbles = map?.bubbles ?? [];
    syncTitle(map?.title ?? "");
    scene.classList.toggle("is-empty-title", !(map?.title ?? "").trim());
    scene.hidden = !map;

    const cc = cloudColor(map?.cloud);
    scene.style.setProperty("--kt-cloud", cc.fill);
    scene.style.setProperty("--kt-cloud-edge", cc.edge);
    scene.style.setProperty("--kt-title-ink", cc.ink);
    scene.style.setProperty("--kt-title-soft", cc.soft);

    // Bubblornas DOM i trädordning (= tabbordningen).
    const seen = new Set();
    const font = baseFontFor(bubbles.length);
    scene.style.setProperty("--kt-font", `${font}px`);
    const colors = resolveColors(bubbles);
    const level = depths(bubbles);
    const ids = new Set(bubbles.map((b) => b.id));
    parentOf = new Map(bubbles.map((b) => [b.id, b.parentId && ids.has(b.parentId) ? b.parentId : null]));
    if (selected && !ids.has(selected)) selected = null;
    for (const b of treeOrder(bubbles)) {
      seen.add(b.id);
      let node = nodes.get(b.id);
      if (!node) {
        node = makeNode(b);
        nodes.set(b.id, node);
        links.append(node.link);
      }
      if (editingId !== b.id && node.text.textContent !== b.text) node.text.textContent = b.text;
      const c = colors.get(b.id);
      const d = level.get(b.id) ?? 1;
      node.el.style.setProperty("--kt-bg", c.bg);
      node.el.style.setProperty("--kt-edge", c.edge);
      node.el.classList.toggle("kt-bubble--d2", d === 2);
      node.el.classList.toggle("kt-bubble--d3", d >= 3);
      node.el.classList.toggle("is-pinned", !!b.pin);
      node.link.classList.toggle("kt-link--branch", d > 1);
      if (d > 1) node.link.style.stroke = c.edge; else node.link.style.removeProperty("stroke");
      node.parent = parentOf.get(b.id);
      node.label = b.text;
      applySelected(node, b.id);
      // Ordningen = tabbordningen. Flytta bara det som står fel — en flyttad
      // nod tappar fokus.
      const at = layer.children[seen.size - 1];
      if (at !== node.el) layer.insertBefore(node.el, at ?? null);
    }
    for (const [id, node] of nodes) {
      if (seen.has(id)) continue;
      node.el.remove();
      node.link.remove();
      nodes.delete(id);
    }

    // Mät (grundstorlek, utan transform).
    for (const node of nodes.values()) {
      node.el.style.transform = "none";
      shrinkWrap(node.el, node.text);
    }
    shrinkWrap(title, title);
    // Tom rubrik: lärarens grå platshållare räknas inte — molnet blir
    // lika stort som på elevskärmen.
    const hasTitle = title.textContent.trim() !== "";
    const tw = hasTitle ? Math.min(TITLE_MAX_W, title.offsetWidth) : 0;
    const th = hasTitle ? title.offsetHeight : TITLE_FONT * 1.25;
    const rx = Math.max(190, tw / 2 + 92);
    const ry = Math.max(112, th / 2 + 66, rx * 0.46);
    const index = new Map(bubbles.map((b, i) => [b.id, i]));
    const sizes = bubbles.map((b) => {
      const node = nodes.get(b.id);
      node.w = node.el.offsetWidth;
      node.h = node.el.offsetHeight;
      const p = parentOf.get(b.id);
      return { w: node.w, h: node.h, pin: dragging?.id === b.id ? dragging.pin : b.pin, parent: p ? index.get(p) : -1 };
    });

    const res = layoutMap({ w: dims.w, h: dims.h, cloud: { rx, ry }, bubbles: sizes });

    // Molnet.
    const cs = res.cloudScale;
    const shape = cloudPath(rx + 4, ry + 4, rx, ry);
    cloudSvg.setAttribute("viewBox", `0 0 ${2 * rx + 8} ${2 * ry + 8}`);
    cloudSvg.setAttribute("width", String(2 * rx + 8));
    cloudSvg.setAttribute("height", String(2 * ry + 8));
    cloudShape.setAttribute("d", shape.d);
    cloud.style.width = `${2 * rx + 8}px`;
    cloud.style.height = `${2 * ry + 8}px`;
    cloud.style.transform = `translate(${center.x}px, ${center.y}px) translate(-50%, -50%) scale(${cs})`;
    lastLayout = { rx: rx * cs, ry: ry * cs, scale: res.scale, ok: res.ok };

    // Målen.
    const anim = animate && canAnimate();
    bubbles.forEach((b, i) => {
      const node = nodes.get(b.id);
      const it = res.items[i];
      const to = { x: it.x, y: it.y, k: res.scale };
      if (dragging?.id === b.id) { node.cur = { ...dragging.pos, k: res.scale }; node.to = null; return; }
      if (!node.cur) {
        // En ny gren växer fram ur sin förälder, en ny huvudbubbla ur molnet.
        const from = nodes.get(node.parent)?.cur ?? center;
        node.cur = anim ? { x: from.x, y: from.y, k: 0.12 } : { ...to };
      }
      node.from = { ...node.cur };
      node.to = to;
      if (!anim) node.cur = { ...to };
    });
    if (anim) {
      animStart = performance.now();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(frame);
      frame = 0;
      for (const node of nodes.values()) { if (node.to) node.cur = { ...node.to }; node.to = null; }
    }
    draw();
  }

  let lastLayout = null;

  /**
   * Balanserad radbrytning (text-wrap: balance) krymper inte rutan — den
   * står kvar i max-bredd med luft på sidorna. Mät de brutna radernas
   * verkliga bredd och sätt rutans bredd efter den längsta.
   */
  function shrinkWrap(box, textEl) {
    box.style.width = "";
    const node = textEl.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.length) return;
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    const tops = new Set(rects.map((r) => Math.round(r.top)));
    if (tops.size < 2) return; // en rad — max-content är redan rätt
    const k = textEl.getBoundingClientRect().width / (textEl.offsetWidth || 1) || 1; // scenens skala
    const longest = Math.max(...rects.map((r) => r.width)) / k;
    const chrome = box === textEl
      ? box.offsetWidth - box.clientWidth + parseFloat(getComputedStyle(box).paddingLeft) + parseFloat(getComputedStyle(box).paddingRight)
      : box.offsetWidth - textEl.offsetWidth;
    box.style.width = `${Math.ceil(longest + chrome + 1)}px`;
  }

  function tick(now) {
    if (destroyed) return;
    const t = Math.min(1, (now - animStart) / ANIM_MS);
    const e = ease(t);
    for (const node of nodes.values()) {
      if (!node.to || !node.from) continue;
      node.cur = {
        x: node.from.x + (node.to.x - node.from.x) * e,
        y: node.from.y + (node.to.y - node.from.y) * e,
        k: node.from.k + (node.to.k - node.from.k) * e,
      };
      if (t >= 1) node.to = null;
    }
    draw();
    frame = t < 1 ? requestAnimationFrame(tick) : 0;
  }

  function draw() {
    for (const node of nodes.values()) {
      const c = node.cur;
      if (!c) continue;
      node.el.style.transform = `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px) translate(-50%, -50%) scale(${c.k.toFixed(4)})`;
      node.el.style.opacity = c.k < 0.5 ? String(Math.max(0, (c.k - 0.1) / 0.4)) : "";
      const p = node.parent ? nodes.get(node.parent)?.cur : null;
      node.link.setAttribute("d", p ? linkPath(p.x, p.y, c.x, c.y) : linkPath(center.x, center.y, c.x, c.y));
    }
  }

  // ---- Markering (lärarvyn) ----

  function applySelected(node, id) {
    const on = editable && selected === id;
    node.el.classList.toggle("is-selected", on);
    node.el.setAttribute("aria-pressed", String(on));
    node.el.querySelector(".kt-bubble__x")?.setAttribute("aria-hidden", String(!on));
    if (editable) {
      node.el.setAttribute("aria-label", node.label + (node.parent ? `, gren under ${nodes.get(node.parent)?.label ?? ""}` : ""));
    }
  }

  function setSelected(id) {
    selected = id && nodes.has(id) ? id : null;
    for (const [nid, node] of nodes) applySelected(node, nid);
  }

  /** Nästa/föregående bubbla i trädordning (= DOM-ordningen). */
  function neighbour(id, dir) {
    const els = [...layer.children];
    if (!els.length) return null;
    const i = els.findIndex((e) => e.dataset.id === id);
    if (i < 0) return els[dir > 0 ? 0 : els.length - 1].dataset.id;
    return els[(i + dir + els.length) % els.length].dataset.id;
  }

  // ---- Lärarvyn: rubrik, ×, dra, dubbelklick ----

  if (editable) {
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); title.blur(); }
      if (e.key === "Escape") { e.preventDefault(); title.blur(); }
    });
    title.addEventListener("input", () => {
      // En rubrik är en rad: klistra in utan radbrytningar.
      const clean = title.textContent.replace(/\s*\n\s*/g, " ");
      if (clean !== title.textContent) title.textContent = clean;
      opts.onTitleInput?.(title.textContent);
      scene.classList.toggle("is-empty-title", !title.textContent.trim());
    });
    title.addEventListener("blur", () => {
      const t = title.textContent.replace(/\s+/g, " ").trim();
      if (t !== title.textContent) title.textContent = t;
      opts.onTitleCommit?.(t);
    });

    layer.addEventListener("click", (e) => {
      const x = e.target.closest(".kt-bubble__x");
      if (!x) return;
      const id = x.closest(".kt-bubble")?.dataset.id;
      if (id) opts.onRemove?.(id);
    });
    layer.addEventListener("keydown", (e) => {
      const el = e.target.closest?.(".kt-bubble");
      if (!el || e.target !== el) return;
      const id = el.dataset.id;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); opts.onRemove?.(id); }
      else if (e.key === "F2") { e.preventDefault(); startEdit(id); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onSelect?.(id, { focusInput: true, via: "key" }); }
      else if (e.key === "Escape") { e.preventDefault(); opts.onSelect?.(null, { focusInput: true, via: "key" }); }
      else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        const next = neighbour(id, e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1);
        nodes.get(next)?.el.focus({ preventScroll: true });
      }
    });
    // Tangentbordet (Tab, pilar) markerar bubblan som får fokus.
    layer.addEventListener("focusin", (e) => {
      const el = e.target.closest?.(".kt-bubble");
      if (el && e.target === el && !editingId && selected !== el.dataset.id) opts.onSelect?.(el.dataset.id, { via: "focus" });
    });
    // Klick på molnet eller på tom yta: tillbaka till huvudnivån.
    host.addEventListener("click", (e) => {
      if (e.target.closest(".kt-bubble") || e.target.closest(".kt-title") || (!scene.contains(e.target) && e.target !== host)) return;
      if (selected) opts.onSelect?.(null, { focusInput: true, via: "pointer" });
    });
    title.addEventListener("focus", () => { if (selected) opts.onSelect?.(null, { via: "title" }); });
    layer.addEventListener("dblclick", (e) => {
      const el = e.target.closest(".kt-bubble");
      if (!el || e.target.closest(".kt-bubble__x")) return;
      startEdit(el.dataset.id);
    });

    layer.addEventListener("pointerdown", (e) => {
      const el = e.target.closest(".kt-bubble");
      if (!el || e.button !== 0 || e.target.closest(".kt-bubble__x") || editingId) return;
      const node = nodes.get(el.dataset.id);
      if (!node?.cur || !dims) return;
      const start = { sx: e.clientX, sy: e.clientY, x: node.cur.x, y: node.cur.y };
      let active = false;
      const move = (ev) => {
        const dx = ev.clientX - start.sx;
        const dy = ev.clientY - start.sy;
        if (!active) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          active = true;
          el.classList.add("is-dragging");
          try { el.setPointerCapture(e.pointerId); } catch { /* ok */ }
        }
        const hw = (node.w * (node.cur.k || 1)) / 2;
        const hh = (node.h * (node.cur.k || 1)) / 2;
        const x = Math.min(dims.w - hw, Math.max(hw, start.x + dx / dims.scale));
        const y = Math.min(dims.h - hh, Math.max(hh, start.y + dy / dims.scale));
        node.cur = { ...node.cur, x, y };
        node.to = null;
        dragging = { id: el.dataset.id, pos: { x, y }, pin: { x: x / dims.w, y: y / dims.h } };
        draw();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        el.classList.remove("is-dragging");
        if (!active || !dragging) {
          dragging = null;
          // Ett klick (ingen dragning) markerar bubblan — tar aldrig bort den.
          if (!active) opts.onSelect?.(el.dataset.id, { focusInput: true, via: "pointer" });
          return;
        }
        const { id, pin } = dragging;
        dragging = null;
        opts.onMove?.(id, pin);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  }

  function startEdit(id) {
    const node = nodes.get(id);
    if (!node || editingId) return;
    editingId = id;
    const before = node.text.textContent;
    const t = node.text;
    t.contentEditable = "plaintext-only";
    if (t.contentEditable !== "plaintext-only") t.contentEditable = "true";
    t.spellcheck = false;
    node.el.classList.add("is-editing");
    t.focus();
    const range = document.createRange();
    range.selectNodeContents(t);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let done = false;
    const finish = (commit, byKey = false) => {
      if (done) return;
      done = true;
      t.removeEventListener("keydown", onKey);
      t.removeEventListener("blur", onBlur);
      t.contentEditable = "false";
      node.el.classList.remove("is-editing");
      editingId = null;
      const text = t.textContent.replace(/\s+/g, " ").trim();
      if (!commit || !text || text === before) {
        t.textContent = before;
        render(map, { animate: false });
      } else {
        opts.onEdit?.(id, text);
      }
      // Enter/Esc: tillbaka till skrivraden (fortsätt skriva grenar under
      // bubblan). Klick någon annanstans: fokus stannar där.
      if (byKey && opts.onSelect) opts.onSelect(id, { focusInput: true, via: "edit" });
      else if (byKey) node.el.focus({ preventScroll: true });
    };
    const onKey = (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true, true); }
      if (e.key === "Escape") { e.preventDefault(); finish(false, true); }
      e.stopPropagation();
    };
    const onBlur = () => finish(true);
    t.addEventListener("keydown", onKey);
    t.addEventListener("blur", onBlur);
  }

  return {
    render,
    /** Markera en bubbla (null = ingen). Bara lärarvyn. */
    setSelected,
    get selected() { return selected; },
    /** Ändra en bubblas text direkt i bubblan (dubbelklick, F2). */
    edit(id) { startEdit(id); },
    /** Ge en bubbla fokus (tangentbordet). */
    focusBubble(id) { nodes.get(id)?.el.focus({ preventScroll: true }); },
    /** Värdytan har bytt storlek: räkna om utan animation. */
    refit() { if (map !== undefined) render(map, { animate: false }); },
    /** Senaste layoutens nyckeltal (för test och utskrift). */
    get layout() { return lastLayout; },
    get element() { return scene; },
    focusTitle() {
      title.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      scene.remove();
    },
  };
}
