/**
 * SYNC — omedelbar kanal lärarfönster → elevskärm (samma dator/webbläsare).
 *
 * Primär transport: BroadcastChannel. Fallback: localStorage-eventet
 * (fungerar i alla webbläsare med samma origin). Kanalen är EFEMÄR —
 * meddelanden som ska överleva omladdning går via datalagret, inte hit.
 *
 * Meddelandekontraktet (vad som skickas och när) är dokumenterat i
 * docs/SYNC.md. Kort: kärnan äger typerna `state`, `state:request`
 * och presence-typerna; lägen publicerar egna händelser under sitt
 * id-namnrum, t.ex. `trafikljus:timer`.
 *
 * API:
 *   const bus = createSyncBus();
 *   bus.publish(type, payload?)        skicka till ALLA andra fönster/flikar
 *   bus.on(type, cb) → unsubscribe     cb({ type, payload, from, at })
 *   bus.on("*", cb)                    lyssna på allt (debug)
 *   bus.close()
 *
 * Egna meddelanden studsar aldrig tillbaka till avsändarfönstret.
 */

const CHANNEL_NAME = "classroom:sync";
const FALLBACK_KEY = "classroom:sync:msg";

/** Är detta fönster lärarvyns inbäddade förhandsvisning (iframe)? */
export function isPreviewWindow() {
  try { return new URLSearchParams(location.search).has("preview"); }
  catch { return false; }
}

/** sessionStorage-nyckeln för enskärmsläget ("Helskärm här", js/ui/student-panel.js). */
export const SINGLESCREEN_RETURN_KEY = "classroom:singlescreenReturn";

/**
 * Är detta fönster LÄRARENS eget fönster i enskärmsläge (elevvy i helskärm
 * via "Helskärm här")? Då sitter läraren vid tangentbordet trots elevvyn,
 * så ett läge får ta emot bläddertangenter där (t.ex. js/modes/vecka.js).
 * Aldrig i förhandsvisningen eller ett separat elevfönster.
 */
export function isSingleScreenWindow() {
  if (isPreviewWindow()) return false;
  try { return sessionStorage.getItem(SINGLESCREEN_RETURN_KEY) != null; }
  catch { return false; }
}

export function createSyncBus() {
  const busId = Math.random().toString(36).slice(2);
  const handlers = new Map(); // type → Set<cb>

  function dispatch(msg) {
    if (!msg || typeof msg.type !== "string" || msg.from === busId) return;
    for (const type of [msg.type, "*"]) {
      for (const cb of handlers.get(type) ?? []) {
        try { cb(msg); } catch (err) { console.warn(`[sync] lyssnare för "${msg.type}":`, err); }
      }
    }
  }

  // -- Transport: BroadcastChannel om den finns, annars storage-event --

  let channel = null;
  let onStorage = null;

  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e) => dispatch(e.data);
  } else {
    onStorage = (e) => {
      if (e.key !== FALLBACK_KEY || !e.newValue) return;
      try { dispatch(JSON.parse(e.newValue)); } catch { /* trasigt meddelande — ignorera */ }
    };
    window.addEventListener("storage", onStorage);
  }

  return {
    publish(type, payload = null) {
      const msg = { type, payload, from: busId, at: Date.now() };
      if (channel) {
        channel.postMessage(msg);
      } else {
        // nonce gör att två identiska meddelanden i rad ändå ger nytt storage-event
        try { localStorage.setItem(FALLBACK_KEY, JSON.stringify({ ...msg, nonce: Math.random() })); }
        catch (err) { console.warn("[sync] fallback-publicering misslyckades:", err); }
      }
    },

    on(type, cb) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(cb);
      return () => handlers.get(type)?.delete(cb);
    },

    close() {
      channel?.close();
      if (onStorage) window.removeEventListener("storage", onStorage);
      handlers.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Presence — "är elevskärmen öppen?"
// Elevskärmen annonserar sig; lärarfönstret pingar och håller status.
// Förhandsvisnings-iframen är TYST (isPreviewWindow) och räknas aldrig.
// ---------------------------------------------------------------------------

/**
 * Kör i ett fönster som VISAR elevvyn (ej förhandsvisning): säger
 * hej direkt, svarar på lärarens ping och hejdå vid stängning.
 * Returnerar stop() — som också skickar hejdå (vy-byte i samma fönster).
 */
export function announceStudentScreen(bus) {
  const bye = () => bus.publish("student:bye");
  const unPing = bus.on("teacher:ping", () => bus.publish("student:pong"));
  window.addEventListener("pagehide", bye);
  bus.publish("student:hello");
  return () => {
    unPing();
    window.removeEventListener("pagehide", bye);
    bye();
  };
}

/**
 * Kör i lärarfönstret: pingar regelbundet och anropar onChange(open)
 * när elevskärmens status ändras. Öppen = livstecken (hello/pong)
 * inom timeoutMs. Returnerar stop().
 */
export function watchStudentScreen(bus, onChange, { pingMs = 2000, timeoutMs = 5500 } = {}) {
  let lastSeen = 0;
  let open = false;

  const set = (next) => { if (next !== open) { open = next; onChange(open); } };
  const seen = () => { lastSeen = Date.now(); set(true); };

  const unsubs = [
    bus.on("student:hello", seen),
    bus.on("student:pong", seen),
    bus.on("student:bye", () => { lastSeen = 0; set(false); }),
  ];

  bus.publish("teacher:ping");
  const interval = setInterval(() => {
    if (open && Date.now() - lastSeen > timeoutMs) set(false);
    bus.publish("teacher:ping");
  }, pingMs);

  return () => {
    clearInterval(interval);
    for (const un of unsubs) un();
  };
}
