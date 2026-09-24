/**
 * AUTH — lösenordsväggen framför hela appen.
 *
 * Två driftlägen, samma API utåt:
 *
 *  - FIREBASE (firebase-config.js ifylld): Firebase Authentication
 *    med e-post + lösenord. SDK:ns egen persistens (IndexedDB) gör
 *    att en redan inloggad lärare förblir inloggad offline. Kan
 *    SDK:n inte ens laddas (ingen nät, CDN blockerad) släpps en
 *    tidigare inloggad lärare in via en lokal sessionsmarkör —
 *    appen får aldrig låsa sig utan anslutning.
 *  - LOKALT (ingen Firebase): ett lokalt lösenord, satt av läraren
 *    vid första start, hashat i localStorage. Det är en enkel vägg
 *    mot nyfikna elever — verklig behörighet kommer från Firebase
 *    Auth + Firestore-regler (Läge 5) när molnet kopplas på.
 *
 * Sessionsmarkören (SESSION_KEY, localStorage) delas mellan fönster
 * i samma webbläsare: elevskärmen ärver lärarens session och visar
 * ALDRIG någon inloggning (se ui/login.js), och utloggning i ett
 * fönster loggar ut alla via storage-eventet.
 *
 * API:
 *   auth.mode                    'local' | 'firebase'
 *   auth.state                   'loading' | 'signedOut' | 'signedIn'
 *   auth.needsSetup              true = lokalt läge utan lösenord ännu
 *   auth.offlineBlocked          true = Firebase-läge, offline, aldrig inloggad här
 *   auth.subscribe(fn)           fn(auth) direkt + vid varje förändring
 *   auth.setupPassword(pw)       lokalt läge, första start
 *   auth.signIn({name?, password})
 *   auth.signOut()               loggar ut ALLA fönster
 *
 * INLOGGNING I FIREBASE-LÄGE: läraren skriver bara sitt FÖRNAMN (eller
 * initialer) — inte en e-postadress. Firebase Auth kräver e-post bakom
 * kulisserna, så förnamnet mappas mot en FAST, dold domän
 * (@klassrum.local): "elias" → "elias@klassrum.local". Domänen visas
 * aldrig i gränssnittet. Kontona skapas i Firebase-konsolen med samma
 * mönster (se docs/DRIFTSATTNING.md); inga konton/lösenord i koden.
 */

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const SDK_BASE = "https://www.gstatic.com/firebasejs/10.12.2";

/** Fast, dold e-postdomän för lärarkonton (läraren skriver bara förnamn). */
export const TEACHER_EMAIL_DOMAIN = "klassrum.local";

/** Förnamn/initialer → intern Firebase-e-post. "Elias" → "elias@klassrum.local". */
export function nameToEmail(name) {
  const id = String(name ?? "").trim().toLowerCase();
  if (!id) return "";
  return id.includes("@") ? id : `${id}@${TEACHER_EMAIL_DOMAIN}`;
}

export const SESSION_KEY = "classroom:auth:session"; // 'local' eller Firebase-uid
const LOCAL_HASH_KEY = "classroom:auth:localHash";

/** Visningsnamn för inloggad lärare ("Elias"), delas mellan fönster. */
export const TEACHER_NAME_KEY = "classroom:auth:displayName";

/** "elias@klassrum.local" → "Elias" (lokal del, versal första bokstav). */
export function displayNameFromEmail(email) {
  const local = String(email ?? "").split("@")[0].trim();
  if (!local) return "";
  return local.charAt(0).toLocaleUpperCase("sv") + local.slice(1);
}

/**
 * Den inloggade lärarens visningsnamn, eller null om okänt (t.ex. gammal
 * session från före namnstämplingen, eller rent lokalt läge). Används för
 * attribution (createdByName) på pass och noteringar.
 */
export function currentTeacherName() {
  try { return localStorage.getItem(TEACHER_NAME_KEY) || null; } catch { return null; }
}

/** SHA-256 → hex. Fallback-hash om crypto.subtle saknas (t.ex. http via LAN-ip). */
async function hashPassword(password) {
  const input = `classroom-salt:${password}`;
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    let h = 5381;
    for (const ch of input) h = (h * 33 + ch.codePointAt(0)) >>> 0;
    return `x${h.toString(16)}`;
  }
}

const readLS = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeLS = (key, val) => {
  try {
    if (val == null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch { /* lagring otillgänglig — sessionen blir per-fönster */ }
};

export function createAuth() {
  const mode = isFirebaseConfigured() ? "firebase" : "local";
  const subscribers = new Set();
  let fbAuth = null; // { auth, api } när Firebase Auth-SDK:n är uppe

  const auth = {
    mode,
    state: "loading",
    needsSetup: mode === "local" && !readLS(LOCAL_HASH_KEY),
    offlineBlocked: false,

    subscribe(fn) {
      subscribers.add(fn);
      fn(auth);
      return () => subscribers.delete(fn);
    },

    /** Lokalt läge, första start: sätt lösenordet och logga in. */
    async setupPassword(password) {
      if (mode !== "local" || !auth.needsSetup) throw new Error("Lösenord finns redan.");
      if (!password || password.length < 4) throw new Error("Minst 4 tecken.");
      writeLS(LOCAL_HASH_KEY, await hashPassword(password));
      auth.needsSetup = false;
      setSignedIn("local");
    },

    async signIn({ name, password }) {
      if (mode === "local") {
        if ((await hashPassword(password)) !== readLS(LOCAL_HASH_KEY)) {
          throw new Error("Fel lösenord.");
        }
        setSignedIn("local");
        return;
      }
      if (!fbAuth) throw new Error("Ingen anslutning — första inloggningen kräver nät.");
      // Läraren skriver bara förnamn — bygg den interna e-posten mot den fasta domänen.
      const email = nameToEmail(name);
      const cred = await fbAuth.api
        .signInWithEmailAndPassword(fbAuth.auth, email, password)
        .catch((err) => { throw new Error(friendlyFirebaseError(err)); });
      rememberTeacher(cred.user);
      setSignedIn(cred.user.uid);
    },

    async signOut() {
      if (fbAuth) await fbAuth.api.signOut(fbAuth.auth).catch(() => {});
      writeLS(SESSION_KEY, null); // storage-eventet loggar ut övriga fönster
      writeLS(TEACHER_NAME_KEY, null);
      setState("signedOut");
    },
  };

  /**
   * Stämpla in lärarens visningsnamn lokalt (för attribution på pass och
   * noteringar) och upserta lärarprofilen teachers/{uid} i Firestore
   * (email + displayName, se DATAMODELL.md). Fel är aldrig fatala —
   * profilen är metadata, inloggningen får inte falla på den.
   */
  function rememberTeacher(user) {
    const name = user.displayName || displayNameFromEmail(user.email);
    if (name) writeLS(TEACHER_NAME_KEY, name);
    void (async () => {
      try {
        const [appMod, fsApi] = await Promise.all([
          import(`${SDK_BASE}/firebase-app.js`),
          import(`${SDK_BASE}/firebase-firestore.js`),
        ]);
        const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
        const db = fsApi.getFirestore(app);
        await fsApi.setDoc(
          fsApi.doc(db, "teachers", user.uid),
          { email: user.email ?? null, displayName: name || null, updatedAt: Date.now() },
          { merge: true },
        );
      } catch (err) {
        console.warn("[auth] kunde inte spara lärarprofilen (försöker vid nästa inloggning):", err);
      }
    })();
  }

  function notify() { for (const fn of subscribers) fn(auth); }
  function setState(state) { auth.state = state; notify(); }
  function setSignedIn(marker) {
    writeLS(SESSION_KEY, marker);
    setState("signedIn");
  }

  // ---- Uppstart ----

  if (mode === "local") {
    setState(readLS(SESSION_KEY) ? "signedIn" : "signedOut");
  } else {
    void startFirebase();
  }

  async function startFirebase() {
    try {
      const [appMod, api] = await Promise.all([
        import(`${SDK_BASE}/firebase-app.js`),
        import(`${SDK_BASE}/firebase-auth.js`),
      ]);
      // Datalagrets Firestore-synk delar samma app-instans — initiera bara en gång.
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
      fbAuth = { auth: api.getAuth(app), api };
      // SDK:n är sanningen: den återställer en persisterad session (även offline).
      api.onAuthStateChanged(fbAuth.auth, (user) => {
        if (user) { rememberTeacher(user); setSignedIn(user.uid); }
        else { writeLS(SESSION_KEY, null); setState("signedOut"); }
      });
    } catch (err) {
      // SDK:n gick inte att ladda (offline/CDN). En redan inloggad lärare
      // släpps in på sessionsmarkören; annars väntar väggen på nät.
      console.warn("[auth] Firebase Auth kunde inte laddas:", err);
      if (readLS(SESSION_KEY)) setState("signedIn");
      else { auth.offlineBlocked = true; setState("signedOut"); }
    }
  }

  // Följ in-/utloggning i andra fönster (lärarfönster ↔ elevskärm).
  window.addEventListener("storage", (e) => {
    if (e.key !== SESSION_KEY) return;
    if (!e.newValue && auth.state === "signedIn") void auth.signOut();
    else if (e.newValue && auth.state === "signedOut") setState("signedIn");
  });

  return auth;
}

function friendlyFirebaseError(err) {
  const code = err?.code ?? "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Fel förnamn eller lösenord.";
  }
  if (code.includes("too-many-requests")) return "För många försök — vänta en stund.";
  if (code.includes("network-request-failed")) return "Ingen anslutning till inloggningstjänsten.";
  return "Inloggningen misslyckades.";
}
