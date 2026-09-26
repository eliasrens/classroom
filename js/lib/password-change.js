/**
 * BYT LÖSENORD — ren logik (issue #49). Ingen DOM, inget nätverk.
 *
 *  - validatePasswordChange: kontrollerna som görs INNAN något skickas
 *    (nuvarande ifyllt, nytt minst MIN_PASSWORD_LENGTH tecken, båda nya
 *    fälten lika, nytt ≠ nuvarande). Ger ett felmeddelande på svenska
 *    och vilket fält det gäller, eller null om allt är i sin ordning.
 *  - changePasswordErrorMessage: Firebase-felkod → begripligt meddelande.
 *
 * Lösenorden själva lämnar aldrig funktionerna — inga loggar, ingen lagring.
 */

export const MIN_PASSWORD_LENGTH = 8;

export const MESSAGES = Object.freeze({
  currentMissing: "Skriv ditt nuvarande lösenord.",
  tooShort: `Det nya lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`,
  mismatch: "De två nya lösenorden stämmer inte överens.",
  sameAsCurrent: "Det nya lösenordet får inte vara samma som det nuvarande.",
  wrongCurrent: "Fel nuvarande lösenord.",
  weak: `Lösenordet är för svagt — välj ett längre (minst ${MIN_PASSWORD_LENGTH} tecken).`,
  network: "Ingen anslutning — lösenordet kan bara bytas när datorn är uppkopplad.",
  tooMany: "För många försök — vänta en stund och försök igen.",
  recentLogin: "Av säkerhetsskäl måste du logga ut och in igen innan du byter lösenord.",
  failed: "Lösenordet kunde inte bytas. Försök igen.",
  done: "Lösenordet är bytt.",
});

/**
 * @param {{current: string, next: string, repeat: string}} fields
 * @returns {null | {field: "current"|"next"|"repeat", message: string}}
 */
export function validatePasswordChange({ current, next, repeat }) {
  current = String(current ?? "");
  next = String(next ?? "");
  repeat = String(repeat ?? "");
  if (!current) return { field: "current", message: MESSAGES.currentMissing };
  if ([...next].length < MIN_PASSWORD_LENGTH) return { field: "next", message: MESSAGES.tooShort };
  if (next !== repeat) return { field: "repeat", message: MESSAGES.mismatch };
  if (next === current) return { field: "next", message: MESSAGES.sameAsCurrent };
  return null;
}

/** Firebase Auth-fel (eller vårt eget) → {field?, message}. */
export function changePasswordErrorMessage(err) {
  const code = String(err?.code ?? "");
  if (code.includes("wrong-password") || code.includes("invalid-credential") || code.includes("invalid-login-credentials")) {
    return { field: "current", message: MESSAGES.wrongCurrent };
  }
  if (code.includes("weak-password")) return { field: "next", message: MESSAGES.weak };
  if (code.includes("network-request-failed")) return { message: MESSAGES.network };
  if (code.includes("too-many-requests")) return { message: MESSAGES.tooMany };
  if (code.includes("requires-recent-login") || code.includes("user-token-expired")) {
    return { message: MESSAGES.recentLogin };
  }
  return { message: MESSAGES.failed };
}
