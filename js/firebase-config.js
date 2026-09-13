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
  apiKey: "AIzaSyAJoZXnidE0hCKa8Xn9b4XfQeXINugVusA",
  authDomain: "klassrum-260913-1c02.firebaseapp.com",
  projectId: "klassrum-260913-1c02",
  storageBucket: "klassrum-260913-1c02.firebasestorage.app",
  messagingSenderId: "199593708075",
  appId: "1:199593708075:web:119cf3c67620202533386e",
};

/** true om konfigurationen ovan fortfarande är platshållaren */
export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey) && !firebaseConfig.apiKey.startsWith("FYLL_I");
}
