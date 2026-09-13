/**
 * SKÄRMAR — Window Management API-hjälpare för att lägga elevfönstret på
 * projektorn (en icke-primär skärm) och köra det i helskärm DÄR, utan att
 * läraren behöver dra fönstret manuellt.
 *
 * Allt är feature-detekterat och inkapslat: saknas API:t (Firefox/Safari),
 * är kontexten osäker (inte https/localhost), finns bara en skärm, eller
 * nekas behörigheten `window-management` — då kastar ingenting, anroparen
 * får bara `null`/`false` tillbaka och faller tillbaka på dagens beteende
 * (vanligt window.open + dubbelklick-för-helskärm, se js/app.js).
 *
 * Kräver Chrome/Edge, https (eller localhost) och ett engångsgodkännande.
 * Se docs/DRIFTSATTNING.md.
 */

/** Stöds Window Management API i en säker kontext? (Feature-detektering.) */
export function supportsWindowManagement() {
  try {
    return typeof window.getScreenDetails === "function" && window.isSecureContext === true;
  } catch {
    return false;
  }
}

/**
 * Hämta skärmdetaljer och välj projektorn: första icke-primära skärmen
 * (fallback: currentScreen). Begär behörigheten `window-management`
 * implicit via getScreenDetails() — anropa inifrån en användargest.
 *
 * Returnerar `{ screenDetails, screen }` eller `null` när API:t saknas,
 * kontexten är osäker, behörigheten nekas, det bara finns en skärm, eller
 * något annat går fel. Kastar aldrig.
 */
export async function getProjectorScreen() {
  if (!supportsWindowManagement()) return null;
  try {
    const screenDetails = await window.getScreenDetails();
    const screens = screenDetails?.screens ?? [];
    // Projektorn = en skärm som inte är den primära. Finns ingen sådan
    // (bara en skärm) → null, så anroparen kör enskärms-fallbacken.
    const screen = screens.find((s) => !s.isPrimary) ?? null;
    if (!screen) return null;
    return { screenDetails, screen };
  } catch {
    // Behörighet nekad eller annat fel — tyst fallback.
    return null;
  }
}

/**
 * `window.open`-features som placerar fönstret över hela projektorns
 * användbara yta. Använder availLeft/availTop/availWidth/availHeight när
 * de finns (utanför systemets aktivitetsfält) och faller tillbaka på
 * left/top/width/height.
 */
export function screenOpenFeatures(screen) {
  const left = screen.availLeft ?? screen.left ?? 0;
  const top = screen.availTop ?? screen.top ?? 0;
  const width = screen.availWidth ?? screen.width ?? 0;
  const height = screen.availHeight ?? screen.height ?? 0;
  return `left=${left},top=${top},width=${width},height=${height}`;
}

/**
 * Best-effort helskärm på projektorn. Anropas i det NYÖPPNADE
 * elevfönstret, som ärver klick-gesten (transient aktivering) från
 * "Öppna elevskärm". Försöker `requestFullscreen({ screen })` mot
 * projektorn; stöds inte skärm-optionen faller vi till vanlig helskärm
 * (fönstret ligger redan på skärm 2). Går inget igenom gör vi inget —
 * dubbelklick-för-helskärm finns kvar. Kastar aldrig.
 */
export async function enterFullscreenOnProjector(element = document.documentElement) {
  try {
    if (typeof element.requestFullscreen !== "function") return false;
    const projector = await getProjectorScreen();
    if (projector?.screen) {
      try {
        await element.requestFullscreen({ screen: projector.screen });
        return true;
      } catch {
        /* skärm-optionen stöds ej / nekades — falla till vanlig helskärm */
      }
    }
    await element.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}
