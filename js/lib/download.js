/**
 * NEDLADDNING av en fil som skapats i webbläsaren (CSV, .klassrum).
 *
 * Helt lokalt: en Blob-URL och ett <a download>-klick — inget nätverk.
 * Blob-URL:en släpps först efter en stund: revokeObjectURL direkt efter
 * click() kan avbryta nedladdningen i vissa webbläsare (Firefox, Safari).
 */

const REVOKE_DELAY_MS = 1500;

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
