/**
 * FIREBASE-KONFIGURATION — PLATSHÅLLARE
 *
 * Klistra in er riktiga konfiguration från Firebase-konsolen här
 * (Projektinställningar → Allmänt → Dina appar → SDK-konfiguration).
 *
 * Så länge apiKey börjar med "FYLL_I" kör appen helt lokalt
 * (offline-läge, all data i webbläsaren) — den kraschar ALDRIG
 * för att Firebase saknas.
 */
export const firebaseConfig = {
  apiKey: "FYLL_I_API_KEY",
  authDomain: "FYLL_I.firebaseapp.com",
  projectId: "FYLL_I_PROJECT_ID",
  storageBucket: "FYLL_I.appspot.com",
  messagingSenderId: "FYLL_I",
  appId: "FYLL_I",
};

/** true om konfigurationen ovan fortfarande är platshållaren */
export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey) && !firebaseConfig.apiKey.startsWith("FYLL_I");
}
