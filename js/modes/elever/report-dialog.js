/**
 * ELEVRAPPORTER — lösenordsdialogen för en krypterad fil (issue #33).
 * ENDAST LÄRARVY.
 *
 * Eget lager på <body> (inte inuti fliken) så att en datadriven omritning
 * aldrig kan tömma ett halvskrivet lösenord. Lösenordet lever bara i
 * inmatningsfälten och skickas direkt till onSubmit — det sparas ALDRIG
 * (inte i minnet efteråt, inte i localStorage, inte någonstans).
 *
 * Krav: minst MIN_PASSWORD_LENGTH tecken, båda fälten lika. Styrkemätare,
 * tydlig varning ("Tappar du lösenordet …") och tipset om muntlig
 * överlämning.
 */

import { icon } from "../../lib/icons.js";
import { escapeHtml } from "./shared.js";
import { passwordStrength, MIN_PASSWORD_LENGTH } from "../../lib/report-crypto.js";

let current = null;

export function closePasswordDialog() {
  if (!current) return;
  window.removeEventListener("keydown", current.onKey, true);
  current.root.remove();
  current = null;
}

/**
 * openPasswordDialog({ title, fileName, summary, submitLabel, onSubmit })
 * onSubmit(password) → Promise; ett kastat fel visas i dialogen.
 */
export function openPasswordDialog({ title, fileName, summary = "", submitLabel = "Kryptera och ladda ned", onSubmit }) {
  closePasswordDialog();
  const root = document.createElement("div");
  root.className = "rap-modal teacher-only";
  root.innerHTML = `
    <form class="rap-dialog" role="dialog" aria-modal="true" aria-labelledby="rap-dialog-title" novalidate>
      <h2 id="rap-dialog-title">${icon("lock")} ${escapeHtml(title)}</h2>
      <p class="rap-dialog__file">${icon("file")}<span><strong>${escapeHtml(fileName)}</strong>${summary ? `<br>${escapeHtml(summary)}` : ""}</span></p>
      <label class="rap-dialog__field">
        <span>Lösenord (minst ${MIN_PASSWORD_LENGTH} tecken)</span>
        <input type="password" name="pw" autocomplete="new-password" spellcheck="false" required>
      </label>
      <div class="rap-meter" data-score="0" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <p class="rap-meter__label" aria-live="polite">Välj gärna en lösenfras med flera ord.</p>
      <label class="rap-dialog__field">
        <span>Upprepa lösenordet</span>
        <input type="password" name="pw2" autocomplete="new-password" spellcheck="false" required>
      </label>
      <p class="rap-dialog__mismatch" role="alert" hidden>Lösenorden är inte likadana.</p>
      <div class="rap-dialog__warn">${icon("shield")}<p><strong>Tappar du lösenordet går filen inte att öppna.</strong>
        Lösenordet sparas ingenstans — inte heller i appen.</p></div>
      <p class="rap-dialog__tip">Ska filen lämnas till en kollega? Säg lösenordet muntligt, skriv det aldrig på USB-stickan.</p>
      <p class="rap-dialog__hint">Spara filen där skolan anvisar — filen är krypterad, men innehåller personuppgifter.</p>
      <p class="rap-dialog__error" role="alert" hidden></p>
      <div class="rap-dialog__actions">
        <button class="btn" type="button" data-cancel>Avbryt</button>
        <button class="btn btn--primary" type="submit" disabled>${icon("download")}<span>${escapeHtml(submitLabel)}</span></button>
      </div>
    </form>`;
  document.body.append(root);

  const form = root.querySelector("form");
  const pw = form.querySelector("[name=pw]");
  const pw2 = form.querySelector("[name=pw2]");
  const meter = form.querySelector(".rap-meter");
  const meterLabel = form.querySelector(".rap-meter__label");
  const mismatch = form.querySelector(".rap-dialog__mismatch");
  const errorEl = form.querySelector(".rap-dialog__error");
  const submit = form.querySelector("[type=submit]");
  let busy = false;

  function update() {
    const s = passwordStrength(pw.value);
    meter.dataset.score = String(pw.value ? s.score : 0);
    meterLabel.textContent = pw.value ? `Styrka: ${s.label}` : "Välj gärna en lösenfras med flera ord.";
    const differs = pw2.value.length > 0 && pw.value !== pw2.value;
    mismatch.hidden = !differs;
    submit.disabled = busy || !s.ok || pw.value !== pw2.value;
  }
  pw.addEventListener("input", update);
  pw2.addEventListener("input", update);

  const onKey = (e) => {
    if (e.key === "Escape" && !busy) { e.preventDefault(); e.stopPropagation(); closePasswordDialog(); }
  };
  window.addEventListener("keydown", onKey, true);
  current = { root, onKey };
  form.querySelector("[data-cancel]").addEventListener("click", () => { if (!busy) closePasswordDialog(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || !passwordStrength(pw.value).ok || pw.value !== pw2.value) return;
    busy = true;
    errorEl.hidden = true;
    submit.disabled = true;
    submit.querySelector("span").textContent = "Krypterar…";
    const value = pw.value;
    try {
      await onSubmit(value);
      pw.value = "";
      pw2.value = "";
      closePasswordDialog();
    } catch (err) {
      console.warn("[rapport] kryptering misslyckades:", err);
      errorEl.textContent = err?.message ?? "Filen kunde inte skapas.";
      errorEl.hidden = false;
      busy = false;
      submit.querySelector("span").textContent = submitLabel;
      update();
    }
  });
  pw.focus();
}
