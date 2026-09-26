/**
 * BYT LÖSENORD — dialog i lärarvyn (issue #49), öppnas från "Lärare ▾".
 *
 * Tre fält: nuvarande, nytt, upprepa nytt. Valideringen (minst 8 tecken,
 * lika, inte samma som nuvarande) och felmeddelandena ligger i
 * js/lib/password-change.js; själva bytet i auth.changePassword (Firebase:
 * reautentisering + updatePassword, lokalt: ny hash).
 *
 * ALDRIG på elevskärmen: dialogen är .teacher-only, öppnas inte i elevvyn
 * och stängs om fönstret växlar dit. Lösenorden lämnar bara formuläret för
 * att gå till auth — de loggas, lagras och skickas aldrig någon annanstans,
 * och fälten töms när dialogen stängs.
 */

import { icon } from "../lib/icons.js";
import { currentTeacherName } from "../auth.js";
import {
  MESSAGES,
  MIN_PASSWORD_LENGTH,
  validatePasswordChange,
  changePasswordErrorMessage,
} from "../lib/password-change.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const isStudentWindow = (store) =>
  store.get().view === "student" ||
  document.documentElement.dataset.theme === "student";

export function initChangePassword({ store, auth }) {
  let root = null;
  let returnFocus = null;
  let busy = false;

  function open() {
    if (root || isStudentWindow(store)) return;
    returnFocus = document.activeElement;
    // Dolt användarnamn: låter webbläsarens lösenordshanterare koppla det
    // nya lösenordet till rätt konto (samma som förnamnet vid inloggning).
    const username = auth.mode === "firebase" ? (currentTeacherName() ?? "").toLowerCase() : "";
    root = document.createElement("div");
    root.className = "pwchange teacher-only";
    root.innerHTML = `
      <div class="pwchange__scrim" data-close></div>
      <form class="pwchange__box card" role="dialog" aria-modal="true" aria-labelledby="pwchange-title" novalidate>
        <header class="pwchange__head">
          <strong id="pwchange-title">${icon("lock")} Byt lösenord</strong>
          <button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Stäng">${icon("x")}</button>
        </header>
        <input type="text" name="username" autocomplete="username" value="${esc(username)}" hidden>
        <label class="auth__field">Nuvarande lösenord
          <input type="password" name="current" autocomplete="current-password" required>
        </label>
        <label class="auth__field">Nytt lösenord
          <input type="password" name="next" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}"
                 aria-describedby="pwchange-rule">
        </label>
        <label class="auth__field">Upprepa nytt lösenord
          <input type="password" name="repeat" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}">
        </label>
        <label class="pwchange__show"><input type="checkbox" name="show"> Visa lösenord</label>
        <p class="pwchange__rule" id="pwchange-rule">Minst ${MIN_PASSWORD_LENGTH} tecken. Du förblir inloggad.</p>
        <p class="auth__error" role="alert" hidden></p>
        <p class="pwchange__done" role="status" hidden></p>
        <div class="pwchange__actions">
          <button type="button" class="btn btn--ghost" data-close>Avbryt</button>
          <button type="submit" class="btn btn--primary">Byt lösenord</button>
        </div>
      </form>`;
    document.body.append(root);

    const form = root.querySelector("form");
    const errEl = root.querySelector(".auth__error");
    const doneEl = root.querySelector(".pwchange__done");
    const submitBtn = form.querySelector('button[type="submit"]');
    const fields = ["current", "next", "repeat"].map((n) => form.elements[n]);

    root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));

    form.elements.show.addEventListener("change", (e) => {
      for (const f of fields) f.type = e.target.checked ? "text" : "password";
    });

    // Rensa felmarkeringen så fort läraren rättar.
    form.addEventListener("input", () => {
      errEl.hidden = true;
      for (const f of fields) f.removeAttribute("aria-invalid");
    });

    function showError({ field, message }) {
      doneEl.hidden = true;
      errEl.textContent = message;
      errEl.hidden = false;
      const input = field ? form.elements[field] : null;
      if (input) { input.setAttribute("aria-invalid", "true"); input.focus(); input.select?.(); }
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      const values = { current: fields[0].value, next: fields[1].value, repeat: fields[2].value };
      const invalid = validatePasswordChange(values);
      if (invalid) { showError(invalid); return; }

      busy = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "Byter …";
      try {
        await auth.changePassword({ current: values.current, next: values.next });
      } catch (err) {
        // Bara felkoden — aldrig lösenorden.
        console.warn("[auth] lösenordsbytet misslyckades:", err?.code ?? "okänt fel");
        if (root) showError(changePasswordErrorMessage(err));
        return;
      } finally {
        busy = false;
        if (root) { submitBtn.disabled = false; submitBtn.textContent = "Byt lösenord"; }
      }
      if (!root) return;
      for (const f of fields) f.value = "";
      errEl.hidden = true;
      doneEl.textContent = MESSAGES.done;
      doneEl.hidden = false;
      // Klart: formuläret blir en bekräftelse med en Stäng-knapp.
      form.classList.add("pwchange--done");
      const closeBtn = form.querySelector('.pwchange__actions [data-close]');
      closeBtn.textContent = "Stäng";
      closeBtn.focus();
    });

    fields[0].focus();
  }

  function close() {
    if (!root) return;
    // Töm fälten innan noden släpps (inga lösenord kvar i DOM:en).
    root.querySelectorAll('input[type="password"], input[name="current"], input[name="next"], input[name="repeat"]')
      .forEach((f) => { f.value = ""; });
    root.remove();
    root = null;
    if (returnFocus?.isConnected) returnFocus.focus?.();
    returnFocus = null;
  }

  // Stäng om fönstret växlar till elevvy (spärren).
  store.subscribe(["view"], ({ view }) => { if (view === "student") close(); });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root) { e.stopPropagation(); close(); }
  });

  return { open, close, isOpen: () => !!root };
}
