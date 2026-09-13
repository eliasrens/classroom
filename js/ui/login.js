/**
 * LOGIN-VY — det enda som renderas före inloggning.
 *
 * Tre varianter:
 *  - Elevskärm (#/elev/…): NEUTRAL väntevy — aldrig formulär, aldrig
 *    lärardata. Fönstret släpps in automatiskt (storage-event) när
 *    läraren loggar in i sitt fönster.
 *  - Lokalt läge, första start: "skapa lösenord".
 *  - Annars: lösenordsformulär (+ förnamnsfält i Firebase-läge).
 *
 * I Firebase-läge loggar läraren in med bara FÖRNAMN (eller initialer),
 * aldrig en e-postadress. Den fasta domänen läggs på i js/auth.js
 * (nameToEmail) och visas aldrig här.
 */

export function renderLogin(el, { auth, view }) {
  if (view === "student") {
    el.innerHTML = `
      <div class="auth auth--student">
        <h1>Strax klart</h1>
        <p>Skärmen startar när läraren är redo.</p>
      </div>`;
    return;
  }

  const isSetup = auth.needsSetup;
  const isFirebase = auth.mode === "firebase";

  el.innerHTML = `
    <form class="auth card" autocomplete="off">
      <div class="auth__brand">
        <span class="brandmark" aria-hidden="true">K</span>
        <h1>Klassrumsverktyget</h1>
      </div>
      ${isSetup
        ? `<p class="auth__intro">Välj ett lösenord för appen (minst 4 tecken).
           Det behövs varje gång appen öppnas i en ny webbläsare.</p>`
        : `<p class="auth__intro">Logga in för att fortsätta.</p>`}
      ${isFirebase ? `
        <label class="auth__field">Förnamn
          <input type="text" name="name" required autocomplete="username"
                 autocapitalize="none" spellcheck="false" autofocus>
        </label>` : ""}
      <label class="auth__field">${isSetup ? "Nytt lösenord" : "Lösenord"}
        <input type="password" name="password" required minlength="4"
               autocomplete="${isSetup ? "new-password" : "current-password"}"
               ${isFirebase ? "" : "autofocus"}>
      </label>
      ${isSetup ? `
        <label class="auth__field">Upprepa lösenordet
          <input type="password" name="password2" required minlength="4" autocomplete="new-password">
        </label>` : ""}
      <p class="auth__error" role="alert" hidden></p>
      <button class="btn btn--primary auth__submit" type="submit">
        ${isSetup ? "Skapa lösenord och starta" : "Logga in"}
      </button>
      ${auth.offlineBlocked
        ? `<p class="auth__hint">Ingen anslutning just nu — första inloggningen
           på en ny enhet kräver nät.</p>` : ""}
    </form>`;

  const form = el.querySelector("form");
  const errorEl = el.querySelector(".auth__error");
  const submitBtn = el.querySelector(".auth__submit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const fd = new FormData(form);
    const password = fd.get("password");

    if (isSetup && password !== fd.get("password2")) {
      showError("Lösenorden matchar inte.");
      return;
    }

    submitBtn.disabled = true;
    try {
      if (isSetup) await auth.setupPassword(password);
      else await auth.signIn({ name: fd.get("name"), password });
      // Lyckad inloggning → auth-prenumeranten i app.js tar över.
    } catch (err) {
      showError(err.message || "Något gick fel — försök igen.");
      submitBtn.disabled = false;
    }
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
}
