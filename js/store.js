/**
 * STATE-STORE — enkelt observerbart tillstånd.
 *
 * Ett platt objekt + prenumerationer. Lägen läser med get() och
 * reagerar med subscribe(); bara appkärnan och UI-komponenter
 * (klassval, router) skriver de globala nycklarna.
 *
 * Globala nycklar:
 *   classId   — id för vald klass (gäller ALLA lägen, även elevskärm)
 *   modeId    — aktivt läge ('morgon' | 'lektion' | 'trafikljus' | 'elever' | 'oversikt')
 *   view      — 'teacher' | 'student' (vilken vy detta fönster visar)
 *   syncState — 'local' | 'online' | 'offline' (sätts av datalagret)
 *   studentOpen — true när en elevskärm är öppen (sätts av presence-
 *                 vakten i js/sync.js; bara meningsfullt i lärarvyn)
 */

export function createStore(initial = {}) {
  let state = { ...initial };
  const subscribers = new Set(); // { keys: Set|null, fn }

  return {
    /** Hela tillståndet (frys inte — läs, kopiera vid behov, mutera aldrig). */
    get: () => state,

    /**
     * Uppdatera en delmängd nycklar. Prenumeranter vars nycklar
     * berörs (eller som lyssnar på allt) notifieras — bara vid
     * faktisk förändring.
     */
    set(patch) {
      const changed = Object.keys(patch).filter((k) => state[k] !== patch[k]);
      if (changed.length === 0) return;
      state = { ...state, ...patch };
      for (const sub of subscribers) {
        if (!sub.keys || changed.some((k) => sub.keys.has(k))) {
          sub.fn(state, changed);
        }
      }
    },

    /**
     * subscribe(fn) — lyssna på allt.
     * subscribe(['classId'], fn) — lyssna på specifika nycklar.
     * Returnerar en avregistreringsfunktion. fn anropas direkt en
     * första gång så att UI kan rita initialt läge.
     */
    subscribe(keysOrFn, maybeFn) {
      const fn = typeof keysOrFn === "function" ? keysOrFn : maybeFn;
      const keys = typeof keysOrFn === "function" ? null : new Set(keysOrFn);
      const sub = { keys, fn };
      subscribers.add(sub);
      fn(state, keys ? [...keys] : Object.keys(state));
      return () => subscribers.delete(sub);
    },
  };
}

/** Appens globala store-instans. */
export const store = createStore({
  classId: null,
  modeId: "morgon",
  view: "teacher",
  syncState: "local",
  studentOpen: false,
});
