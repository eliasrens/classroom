/**
 * STRESSTEST — flikbyten (issue #25).
 *
 * Klistra in i webbläsarkonsolen i ett INLOGGAT lärarfönster (gärna med
 * elevskärmen öppen i ett annat fönster). Kör N snabba flikbyten i följd
 * — blandat klick i menyn, tangentgenvägar 1–5 (även med fokus kvar på
 * kryssruta/klassväljare) och klassbyten — och kontrollerar efter VARJE
 * byte att rätt läge faktiskt är monterat i <main>.
 *
 * Resultat: { ok, steps, failures, throttled, maxSettleMs }. ok = true
 * betyder att navigeringen aldrig fastnade. `throttled` = byten som
 * WEBBLÄSAREN ignorerade (Chrome stryper >~200 hash-navigeringar per 10 s)
 * — vänta ~10 s mellan körningar så blir den 0.
 */
(async function stressFlikbyten(N = 50) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MARK = {
    morgon: ".morgon",
    lektion: ".lesson, .lesson-empty",
    trafikljus: ".tl, .mode-placeholder",
    elever: ".elever, .mode-placeholder",
    oversikt: ".oversikt",
  };
  const ORDER = ["morgon", "lektion", "trafikljus", "elever", "oversikt"];
  const view = document.querySelector("#view");
  const links = [...document.querySelectorAll("#mode-nav a")];
  const select = document.querySelector("#class-select");
  const classIds = () => [...select.options].map((o) => o.value).filter((v) => v && !v.startsWith("__"));
  const mounted = (id) => !!view.querySelector(`.view__slot[data-mode="${id}"] :is(${MARK[id]})`);
  const failures = [];
  let maxSettleMs = 0;
  let throttled = 0;

  // Elevlistans Registrera-flik stänger (medvetet) av 1–5 — använd då klick.
  // Appen vet om läget först när hashchange körts; ett klick som satt ny
  // hash men ännu inte hunnit dit räknas därför också (båda kontrolleras).
  let handledHash = location.hash;
  const onHash = () => { handledHash = location.hash; };
  window.addEventListener("hashchange", onHash);
  const inRegister = (h) =>
    h === "#/elever" && (sessionStorage.getItem("classroom:elever:tab") ?? "registrera") === "registrera";
  const keysAllowed = () => !inRegister(location.hash) && !inRegister(handledHash);

  for (let i = 0; i < N; i++) {
    const target = ORDER[Math.floor(Math.random() * ORDER.length)];
    const how = Math.random();

    if (i % 3 === 0 && classIds().length > 1) {
      // Klassbyte mitt i allt — och lämna fokus kvar på klassväljaren.
      const ids = classIds();
      select.focus();
      select.value = ids[(ids.indexOf(select.value) + 1) % ids.length];
      select.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (i % 5 === 1) {
      document.querySelector("#view input[type=checkbox]")?.focus();
    }

    const wantHash = `#/${target}`;
    if (how < 0.5 || !keysAllowed()) {
      links[ORDER.indexOf(target)].click();
    } else {
      const key = String(ORDER.indexOf(target) + 1);
      const t = document.activeElement ?? document.body;
      const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      t.dispatchEvent(ev);
      // Genvägen hanterade inte tangenten alls → appfel (t.ex. fokus som
      // svalde den). Det var just det som hände före issue #25.
      if (!ev.defaultPrevented && location.hash !== wantHash) {
        failures.push({ step: i, target, reason: `tangent ${key} ignorerades (fokus: ${t.tagName}.${t.type ?? ""})` });
        continue;
      }
    }
    // Chrome stryper tyst hash-navigeringar (~200 per 10 s): då står hashen
    // kvar trots att appen gjorde rätt. Räknas separat — inte som appfel.
    if (location.hash !== wantHash) { throttled++; continue; }

    // Ibland: nästa byte direkt, utan att vänta på monteringen.
    if (Math.random() < 0.3) continue;

    const t0 = performance.now();
    while (!mounted(target) && performance.now() - t0 < 5000) await sleep(10);
    const ms = performance.now() - t0;
    maxSettleMs = Math.max(maxSettleMs, ms);
    if (!mounted(target)) failures.push({ step: i, target, hash: location.hash, html: view.innerHTML.slice(0, 80) });
  }

  // Slutkontroll: sista begärda läget ska vara monterat.
  await sleep(300);
  const last = location.hash.replace(/^#\//, "");
  if (!mounted(last)) failures.push({ step: "final", target: last });

  window.removeEventListener("hashchange", onHash);
  const result = { ok: failures.length === 0, steps: N, failures, throttled, maxSettleMs: Math.round(maxSettleMs) };
  console.log("[stress] flikbyten:", result);
  return result;
})();
