/**
 * LOTTNING (issue #47) — läraren drar ur en lista och eleverna ser
 * dragningen på elevskärmen. Varje dragning tar högst 3 s.
 *
 * Listor: Klassen (den lokala elevlistan, minus dagens frånvarande),
 * Färger (valbara ur en förinställd lista) och egna listor (en rad per
 * alternativ, sparade med namn). Sätt: Lyckohjul, Namnrulle, Dra en
 * lapp och Direkt (ingen animation). prefers-reduced-motion → kort toning.
 *
 * Inga upprepningar: "Ta bort den som dragits" per lista (standard på för
 * Klassen). De dragna sparas lokalt per klass och lista, visas nedtonade
 * under "Redan dragna" och kommer tillbaka med "Hela klassen på nytt" /
 * "Alla på nytt" — eller en i taget med "Ångra senaste".
 *
 * Rättvis slump och synk: LÄRAREN avgör resultatet (crypto.getRandomValues
 * utan modulo-bias, js/lib/lotta.js) och skickar det på sync-bussen som
 * `lotta:draw` { stage, draw } — scenen med alternativen och resultatet,
 * plus fröet och vinklarna för animationen. Elevskärmen spelar upp exakt
 * samma animation (js/modes/lotta/stage.js) och landar på samma resultat.
 * Utan dragning skickas scenen som `lotta:stage` (byte av lista/sätt).
 *
 * Data: ALLT ligger i den ENDAST LOKALA classes/{cid}/lotta (namn är
 * elevdata — js/data/local-only.js). Ingenting når Firestore, och ingen
 * historik över dragningar sparas i molnet. Dokument (DATAMODELL.md):
 *   settings   { list, method, colors, removeDrawn: { [lista]: bool } }
 *   absent     { date, ids }            — frånvarande idag (nollställs nästa dag)
 *   drawn      { lists: { [lista]: [nyckel] } } — "Redan dragna", i dragordning
 *   stage      scenen (se stage.js) — en omladdad elevskärm visar samma sak
 *   list-<id>  { name, text }           — en egen lista
 */

import { icon } from "../lib/icons.js";
import { studentLabel } from "../lib/names.js";
import { typingInField } from "../ui/shortcuts.js";
import {
  METHODS, METHOD_IDS, DEFAULT_METHOD, DURATION_MS, WHEEL_COMFORT_MAX,
  LIST_CLASS, LIST_COLORS, isCustomList, COLORS, DEFAULT_COLOR_IDS,
  randomInt, randomSeed, absentToday, todayKey,
  studentItems, colorItems, customItems, buildPool, drawnItems,
  wheelTarget, reelLand, normAngle,
} from "../lib/lotta.js";
import { createStage, normalizeStage, normalizeDraw } from "./lotta/stage.js";

const EV_DRAW = "lotta:draw";
const EV_STAGE = "lotta:stage";
const TEXT_SAVE_MS = 350;

const lottaPath = (cid) => `classes/${cid}/lotta`;

const METHOD_ICONS = { hjul: "wheel", rulle: "reel", lapp: "note", direkt: "bolt" };

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function normalizeSettings(raw) {
  const list = raw?.list === LIST_CLASS || raw?.list === LIST_COLORS || isCustomList(raw?.list) ? raw.list : LIST_CLASS;
  const known = new Set(COLORS.map((c) => c.id));
  const removeDrawn = {};
  for (const [k, v] of Object.entries(raw?.removeDrawn ?? {})) if (typeof v === "boolean") removeDrawn[k] = v;
  return {
    list,
    method: METHOD_IDS.includes(raw?.method) ? raw.method : DEFAULT_METHOD,
    colors: Array.isArray(raw?.colors) ? raw.colors.filter((id) => known.has(id)) : [...DEFAULT_COLOR_IDS],
    removeDrawn,
  };
}

function normalizeDrawn(raw) {
  const lists = {};
  for (const [k, v] of Object.entries(raw?.lists ?? {})) {
    if (Array.isArray(v)) lists[k] = v.filter((x) => typeof x === "string");
  }
  return { lists };
}

const newListId = () => {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return `list-${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};

export default {
  id: "lotta",
  title: "Lottning",
  icon: "wheel",

  async mount(el, ctx) {
    const offs = [];
    this._offs = offs; // städning registreras innan något startas

    const { view, activeClass, data, sync } = ctx;
    const isStudent = view === "student";

    if (!activeClass) {
      el.innerHTML = `
        <div class="mode-placeholder">
          <div class="mode-placeholder__icon">${icon("wheel", { size: 44, strokeWidth: 1.4 })}</div>
          <h1>Lottning</h1>
          <p>${isStudent ? "Ingen klass vald." : "Välj en klass i topbaren för att lotta."}</p>
        </div>`;
      return;
    }

    const cid = activeClass.id;
    el.innerHTML = isStudent ? studentMarkup() : teacherMarkup();
    const stageView = createStage(el.querySelector(".lot-stage"));
    offs.push(() => stageView.destroy());

    if (isStudent) mountStudent();
    else mountTeacher();

    // ---- Elevskärmen: bara scenen, följer läraren ----

    function mountStudent() {
      let shownRev = -1;
      const apply = (raw) => {
        const st = normalizeStage(raw);
        if (!st || st.rev <= shownRev) return; // en sen sparning — bussen har redan nyare
        shownRev = st.rev;
        stageView.render(st);
      };
      offs.push(data.watch(lottaPath(cid), (docs) => apply(docs.find((d) => d.id === "stage"))));
      offs.push(sync.on(EV_STAGE, ({ payload }) => apply(payload)));
      offs.push(sync.on(EV_DRAW, ({ payload }) => {
        const st = normalizeStage(payload?.stage);
        const draw = normalizeDraw(payload?.draw, st);
        if (!st || !draw || st.rev <= shownRev) return;
        shownRev = st.rev;
        stageView.play(st, draw, { offset: Math.max(0, Date.now() - draw.startedAt) });
      }));
    }

    // ---- Lärarvyn ----

    function mountTeacher() {
      const $ = (sel) => el.querySelector(sel);
      const listsEl = $(".lot-lists");
      const listBox = $(".lot-listbox");
      const methodBtns = [...el.querySelectorAll("[data-method]")];
      const drawBtn = $('[data-act="draw"]');
      const undoBtn = $('[data-act="undo"]');
      const countEl = $(".lot-count");
      const noticeEl = $(".lot-notice");
      const removeChk = $('[data-act="remove-drawn"]');
      const drawnBox = $(".lot-drawn");
      const drawnList = $(".lot-drawn__list");
      const drawnCount = $(".lot-drawn__count");
      const resetBtn = $('[data-act="reset"]');

      let settings = normalizeSettings(null);
      let absentDoc = null;
      let drawn = normalizeDrawn(null);
      let custom = [];      // [{ id, name, text, createdAt }]
      let students = [];
      let initials = false;
      let stage = null;
      let drawing = false;
      let loaded = false;
      let textTimer = 0;
      offs.push(() => clearTimeout(textTimer));

      // ---- Lagring (lokal) ----

      const save = (id, doc) => { void data.put(lottaPath(cid), { id, ...doc }); };
      const saveSettings = () => save("settings", settings);
      const saveDrawn = () => save("drawn", drawn);

      // ---- Listornas innehåll och poolen ----

      const customList = (key) => custom.find((l) => l.id === key) ?? null;
      const listKey = () => settings.list;
      const kindOf = (key) => (key === LIST_CLASS ? "names" : key === LIST_COLORS ? "colors" : "text");
      const removeDrawnFor = (key) => settings.removeDrawn[key] ?? (key === LIST_CLASS);
      const drawnFor = (key) => drawn.lists[key] ?? [];
      const absentIds = () => absentToday(absentDoc);

      function itemsFor(key) {
        if (key === LIST_CLASS) return studentItems(students, (s) => studentLabel(s, { initials }));
        if (key === LIST_COLORS) return colorItems(settings.colors);
        return customItems(customList(key)?.text);
      }

      function poolFor(key, items = itemsFor(key)) {
        return buildPool(items, {
          absent: key === LIST_CLASS ? absentIds() : [],
          drawn: drawnFor(key),
          removeDrawn: removeDrawnFor(key),
        });
      }

      const listTitle = (key) => (key === LIST_CLASS ? "Klassen" : key === LIST_COLORS ? "Färger" : customList(key)?.name || "Lista");

      function emptyMessage(key, items) {
        if (items.length === 0) {
          if (key === LIST_CLASS) return "Inga elever i elevlistan. Lägg till elever under Lärare → Elevlista.";
          if (key === LIST_COLORS) return "Välj minst en färg till höger.";
          return "Skriv alternativen till höger, ett per rad.";
        }
        if (key === LIST_CLASS && poolFor(key, items).length === 0 && drawnItems(items, drawnFor(key)).length === 0) {
          return "Alla är frånvarande idag.";
        }
        return "Alla har dragits.";
      }

      // ---- Scenen ut: egen vy + elevskärmen (buss + lokal lagring) ----

      const nextRev = () => Math.max(Date.now(), (stage?.rev ?? 0) + 1);
      const toStageItems = (pool) => pool.map(({ label, color }) => (color ? { label, color } : { label }));

      function makeStage(pool, result = null) {
        return {
          rev: nextRev(),
          seq: stage?.seq ?? 0,
          method: settings.method,
          listKey: listKey(),
          kind: kindOf(listKey()),
          items: toStageItems(pool),
          result,
          angle: normAngle(stage?.angle),
          reelIndex: 0,
        };
      }

      function showStage() {
        const items = itemsFor(listKey());
        stageView.render(stage, { message: stage.items.length ? "" : emptyMessage(listKey(), items) });
      }

      /** Ny scen ur nuvarande inställningar (ett ev. resultat försvinner). */
      function updateStage() {
        if (drawing) return;
        stage = makeStage(poolFor(listKey()));
        showStage();
        sync.publish(EV_STAGE, stage);
        save("stage", stage);
        renderStatus();
      }

      /** Listan ändrades utifrån (elevlistan, namnvisning): rita om om inget resultat visas. */
      function refresh() {
        if (!drawing && stage?.result == null) updateStage();
        else renderStatus();
      }

      // ---- Dra ----

      function draw() {
        if (drawing || !loaded) return;
        const key = listKey();
        const pool = poolFor(key);
        if (pool.length === 0) return;
        const n = pool.length;
        const index = randomInt(n);            // resultatet: rättvist, avgjort här
        const seed = randomSeed();             // bara animationen
        const prev = stage;
        const from = normAngle(prev?.angle);
        const start = prev && prev.listKey === key && prev.reelIndex < n ? prev.reelIndex : 0;
        const to = wheelTarget(from, n, index, seed);
        const land = reelLand(n, start, index, seed);

        stage = { ...makeStage(pool, index), seq: (prev?.seq ?? 0) + 1, angle: normAngle(to), reelIndex: index };
        const payload = {
          seq: stage.seq,
          method: stage.method,
          list: key,
          resultIndex: index,
          seed,
          from,
          to,
          start,
          land,
          startedAt: Date.now(),
        };
        sync.publish(EV_DRAW, { stage, draw: payload });
        save("stage", stage);
        if (removeDrawnFor(key)) {
          drawn.lists[key] = [...drawnFor(key), pool[index].key];
          saveDrawn();
        }
        drawing = true;
        renderStatus();
        stageView.play(stage, payload, {
          onDone: () => {
            drawing = false;
            renderStatus();
          },
        });
      }

      function undo() {
        if (drawing) return;
        const key = listKey();
        const list = drawnFor(key);
        if (removeDrawnFor(key) && list.length) {
          drawn.lists[key] = list.slice(0, -1);
          saveDrawn();
        }
        updateStage();
      }

      function resetDrawn() {
        if (drawing) return;
        drawn.lists[listKey()] = [];
        saveDrawn();
        updateStage();
      }

      // ---- Kontrollerna ----

      function renderLists() {
        const btn = (key, label) => `<button type="button" class="btn lot-listbtn" data-list="${escapeHtml(key)}"
          aria-pressed="${key === listKey()}">${escapeHtml(label)}</button>`;
        listsEl.innerHTML = [
          btn(LIST_CLASS, "Klassen"),
          btn(LIST_COLORS, "Färger"),
          ...custom.map((l) => btn(l.id, l.name || "Namnlös lista")),
          `<button type="button" class="btn btn--ghost lot-listbtn" data-act="new-list">${icon("plus")}<span>Ny lista</span></button>`,
        ].join("");
      }

      function renderMethods() {
        for (const b of methodBtns) b.setAttribute("aria-pressed", String(b.dataset.method === settings.method));
      }

      /** Listans egen ruta: närvaro (Klassen), färgval (Färger) eller redigering (egen lista). */
      function renderListBox() {
        const key = listKey();
        if (key === LIST_CLASS) {
          const items = itemsFor(key);
          const absent = new Set(absentIds());
          listBox.innerHTML = `
            <h2 class="lot-h">Närvaro idag</h2>
            <p class="lot-sub">Bocka ur den som är frånvarande. Gäller bara idag.</p>
            ${items.length ? `<ul class="lot-checks">${items.map((it) => `
              <li><label class="lot-check"><input type="checkbox" data-absent="${escapeHtml(it.key)}" ${absent.has(it.key) ? "" : "checked"}>
                <span>${escapeHtml(it.label)}</span></label></li>`).join("")}</ul>
              <button type="button" class="btn btn--ghost" data-act="all-present">${icon("check")}<span>Alla är här</span></button>`
              : `<p class="lot-sub">Elevlistan är tom.</p>`}`;
        } else if (key === LIST_COLORS) {
          const on = new Set(settings.colors);
          listBox.innerHTML = `
            <h2 class="lot-h">Färger</h2>
            <ul class="lot-checks lot-checks--colors">${COLORS.map((c) => `
              <li><label class="lot-check"><input type="checkbox" data-color="${c.id}" ${on.has(c.id) ? "checked" : ""}>
                <span class="lot-swatch" style="background:${c.hex}"></span><span>${escapeHtml(c.name)}</span></label></li>`).join("")}</ul>`;
        } else {
          const l = customList(key);
          listBox.innerHTML = `
            <h2 class="lot-h">Egen lista</h2>
            <label class="lot-field"><span>Namn</span>
              <input type="text" data-field="name" maxlength="40" value="${escapeHtml(l?.name ?? "")}" placeholder="T.ex. Stationer"></label>
            <label class="lot-field"><span>Alternativ, ett per rad</span>
              <textarea data-field="text" rows="8" placeholder="Läsa&#10;Skriva&#10;Räkna">${escapeHtml(l?.text ?? "")}</textarea></label>
            <div class="lot-row">
              <button type="button" class="btn btn--ghost" data-act="delete-list">${icon("trash")}<span>Ta bort listan</span></button>
              <span class="lot-confirm" hidden>
                <span>Ta bort listan?</span>
                <button type="button" class="btn lot-danger" data-act="confirm-delete">Ta bort</button>
                <button type="button" class="btn btn--ghost" data-act="cancel-delete">Avbryt</button>
              </span>
            </div>`;
        }
      }

      /** Räknare, knappar, "Redan dragna", meddelanden. */
      function renderStatus() {
        const key = listKey();
        const items = itemsFor(key);
        const pool = poolFor(key, items);
        const remove = removeDrawnFor(key);
        const done = drawnItems(items, drawnFor(key));
        const all = key === LIST_CLASS ? "Hela klassen på nytt" : "Alla på nytt";

        drawBtn.disabled = drawing || pool.length === 0;
        undoBtn.disabled = drawing || !(remove ? done.length > 0 : stage?.result != null);
        const absent = key === LIST_CLASS ? items.length - buildPool(items, { absent: absentIds() }).length : 0;
        countEl.textContent = items.length === 0 ? ""
          : remove ? `${pool.length} kvar av ${items.length - absent}` : `${pool.length} att dra bland`;

        removeChk.checked = remove;
        drawnBox.hidden = !remove;
        drawnCount.textContent = done.length ? `(${done.length})` : "";
        drawnList.innerHTML = done.length
          ? done.map((it) => `<li>${it.color ? `<span class="lot-swatch" style="background:${it.color}"></span>` : ""}${escapeHtml(it.label)}</li>`).join("")
          : `<li class="lot-drawn__none">Ingen ännu.</li>`;
        resetBtn.querySelector("span").textContent = all;
        resetBtn.disabled = drawing || done.length === 0;

        // "Alla har dragits — börja om?" / för många för hjulet
        let notice = "";
        if (!drawing && remove && pool.length === 0 && done.length > 0) {
          notice = `<span>Alla har dragits — börja om?</span>
            <button type="button" class="btn btn--primary" data-act="reset">${icon("refresh")}<span>${all}</span></button>`;
        } else if (settings.method === "hjul" && pool.length > WHEEL_COMFORT_MAX) {
          notice = `<span>${pool.length} alternativ — texten blir liten på hjulet.</span>
            <button type="button" class="btn" data-act="use-reel">${icon("reel")}<span>Byt till namnrulle</span></button>`;
        }
        noticeEl.innerHTML = notice;
        noticeEl.hidden = !notice;
      }

      function renderAll() {
        renderLists();
        renderMethods();
        renderListBox();
        renderStatus();
      }

      // ---- Händelser ----

      el.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || !el.contains(b)) return;
        if (b.dataset.list) return selectList(b.dataset.list);
        if (b.dataset.method) return selectMethod(b.dataset.method);
        switch (b.dataset.act) {
          case "draw": return draw();
          case "undo": return undo();
          case "reset": return resetDrawn();
          case "use-reel": return selectMethod("rulle");
          case "new-list": return newList();
          case "all-present":
            absentDoc = { date: todayKey(), ids: [] };
            save("absent", absentDoc);
            renderListBox();
            return updateStage();
          case "delete-list":
            b.hidden = true;
            listBox.querySelector(".lot-confirm").hidden = false;
            return listBox.querySelector('[data-act="confirm-delete"]').focus();
          case "cancel-delete":
            listBox.querySelector(".lot-confirm").hidden = true;
            listBox.querySelector('[data-act="delete-list"]').hidden = false;
            return undefined;
          case "confirm-delete": return deleteList();
          default: return undefined;
        }
      });

      el.addEventListener("change", (e) => {
        const t = e.target;
        if (t.matches('[data-act="remove-drawn"]')) {
          settings.removeDrawn[listKey()] = t.checked;
          saveSettings();
          return updateStage();
        }
        if (t.dataset.absent) {
          const ids = new Set(absentIds());
          if (t.checked) ids.delete(t.dataset.absent); else ids.add(t.dataset.absent);
          absentDoc = { date: todayKey(), ids: [...ids] };
          save("absent", absentDoc);
          return updateStage();
        }
        if (t.dataset.color) {
          const on = new Set(settings.colors);
          if (t.checked) on.add(t.dataset.color); else on.delete(t.dataset.color);
          settings.colors = COLORS.map((c) => c.id).filter((id) => on.has(id));
          saveSettings();
          return updateStage();
        }
        return undefined;
      });

      el.addEventListener("input", (e) => {
        const t = e.target;
        const l = customList(listKey());
        if (!l || !t.dataset.field) return;
        l[t.dataset.field] = t.value;
        if (t.dataset.field === "name") {
          const b = listsEl.querySelector(`[data-list="${CSS.escape(l.id)}"]`);
          if (b) b.textContent = t.value || "Namnlös lista";
        }
        clearTimeout(textTimer);
        textTimer = setTimeout(() => {
          save(l.id, { name: l.name, text: l.text });
          if (t.dataset.field === "text") updateStage();
        }, TEXT_SAVE_MS);
      });

      // Mellanslag = Dra (inte i textfält, och inte på en knapp/kryssruta som själv använder tangenten).
      const onKey = (e) => {
        if (e.key !== " " || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (typingInField(t) || t?.closest?.("button, input, select, textarea, dialog, [contenteditable]")) return;
        if (document.querySelector("dialog[open]")) return;
        e.preventDefault();
        draw();
      };
      document.addEventListener("keydown", onKey);
      offs.push(() => document.removeEventListener("keydown", onKey));

      function selectList(key) {
        if (drawing || key === listKey()) return;
        flushText();
        settings.list = key;
        saveSettings();
        renderLists();
        renderListBox();
        updateStage();
      }

      function selectMethod(m) {
        if (drawing || !METHOD_IDS.includes(m) || m === settings.method) return;
        settings.method = m;
        saveSettings();
        renderMethods();
        // Samma resultat kan stå kvar — bara visat på det nya sättet.
        stage = { ...(stage ?? makeStage(poolFor(listKey()))), method: m, rev: nextRev() };
        showStage();
        sync.publish(EV_STAGE, stage);
        save("stage", stage);
        renderStatus();
      }

      function flushText() {
        if (!textTimer) return;
        clearTimeout(textTimer);
        textTimer = 0;
        const l = customList(listKey());
        if (l) save(l.id, { name: l.name, text: l.text });
      }
      offs.push(flushText);

      function newList() {
        if (drawing) return;
        flushText();
        const l = { id: newListId(), name: "", text: "", createdAt: Date.now() };
        custom.push(l);
        save(l.id, { name: l.name, text: l.text });
        settings.list = l.id;
        settings.removeDrawn[l.id] = false;
        saveSettings();
        renderAll();
        updateStage();
        listBox.querySelector('[data-field="name"]')?.focus();
      }

      function deleteList() {
        const key = listKey();
        if (!isCustomList(key)) return;
        clearTimeout(textTimer);
        textTimer = 0;
        custom = custom.filter((l) => l.id !== key);
        void data.remove(lottaPath(cid), key);
        delete drawn.lists[key];
        delete settings.removeDrawn[key];
        saveDrawn();
        settings.list = LIST_CLASS;
        saveSettings();
        renderAll();
        updateStage();
      }

      // ---- Start: läs det sparade (lokalt, synkront) ----

      offs.push(data.watch(lottaPath(cid), (docs) => {
        if (loaded) return; // lärarvyn är enda skribenten — bara första svaret
        loaded = true;
        const byId = new Map(docs.map((d) => [d.id, d]));
        settings = normalizeSettings(byId.get("settings"));
        absentDoc = byId.get("absent") ?? null;
        drawn = normalizeDrawn(byId.get("drawn"));
        custom = docs.filter((d) => isCustomList(d.id))
          .map((d) => ({ id: d.id, name: String(d.name ?? ""), text: String(d.text ?? ""), createdAt: d.createdAt ?? 0 }))
          .sort((a, b) => a.createdAt - b.createdAt);
        if (isCustomList(settings.list) && !customList(settings.list)) settings.list = LIST_CLASS;
        const saved = normalizeStage(byId.get("stage"));
        renderAll();
        // Ett landat resultat står kvar efter omladdning; annars en färsk scen.
        if (saved && saved.result != null && saved.listKey === listKey() && saved.method === settings.method) {
          stage = { ...saved, rev: nextRev() };
          showStage();
          sync.publish(EV_STAGE, stage); // en redan öppen elevskärm visar direkt samma sak
          renderStatus();
        } else {
          stage = saved;
          updateStage();
        }
      }));

      offs.push(data.watch(`classes/${cid}/students`, (docs) => {
        students = docs;
        if (!loaded) return;
        if (listKey() === LIST_CLASS) renderListBox();
        refresh();
      }));
      offs.push(data.watch(`classes/${cid}/settings`, (docs) => {
        const next = docs.find((d) => d.id === "display")?.value?.nameDisplay === "initials";
        if (next === initials) return;
        initials = next;
        if (!loaded || listKey() !== LIST_CLASS) return;
        renderListBox();
        refresh();
      }));
    }
  },

  async unmount() {
    for (const off of (this._offs ?? []).splice(0)) { try { off(); } catch { /* ok */ } }
  },
};

// ---- Markup-mallar --------------------------------------------------------

function studentMarkup() {
  return `
    <section class="lot lot--student">
      <div class="lot-stage" data-phase="idle"></div>
    </section>`;
}

function teacherMarkup() {
  const maxS = Math.max(...Object.values(DURATION_MS)) / 1000;
  return `
    <section class="lot lot--teacher">
      <div class="lot-main">
        <div class="lot-seg teacher-only" role="group" aria-label="Sätt att dra">
          ${METHODS.map((m) => `<button type="button" class="btn lot-segbtn" data-method="${m.id}" aria-pressed="false">
            ${icon(METHOD_ICONS[m.id])}<span>${m.label}</span></button>`).join("")}
        </div>
        <div class="lot-stage theme-student" data-phase="idle"></div>
        <div class="lot-actions teacher-only">
          <button type="button" class="btn btn--primary lot-draw" data-act="draw" title="Dra (mellanslag)">${icon("play")}<span>Dra</span></button>
          <span class="lot-count" aria-live="polite"></span>
          <button type="button" class="btn btn--ghost" data-act="undo" title="Ångra senaste dragningen — den dragna kommer tillbaka">${icon("undo")}<span>Ångra senaste</span></button>
        </div>
        <p class="lot-notice teacher-only" role="status" hidden></p>
        <p class="lot-hint teacher-only">Skicka ut med <strong>Visa på elevskärm</strong>. Eleverna ser dragningen, aldrig listorna.
          Varje dragning tar högst ${Math.ceil(maxS)} sekunder. Listorna sparas bara på den här datorn, aldrig i molnet.</p>
      </div>

      <aside class="lot-side teacher-only" aria-label="Lottningens listor">
        <section class="lot-box">
          <h2 class="lot-h">Lista</h2>
          <div class="lot-lists" role="group" aria-label="Lista att dra ur"></div>
        </section>
        <section class="lot-box lot-listbox"></section>
        <section class="lot-box">
          <h2 class="lot-h">Inga upprepningar</h2>
          <label class="lot-check"><input type="checkbox" data-act="remove-drawn"><span>Ta bort den som dragits</span></label>
          <div class="lot-drawn" hidden>
            <h3 class="lot-h3">Redan dragna <span class="lot-drawn__count"></span></h3>
            <ol class="lot-drawn__list"></ol>
            <button type="button" class="btn" data-act="reset">${icon("refresh")}<span>Alla på nytt</span></button>
          </div>
        </section>
      </aside>
    </section>`;
}
