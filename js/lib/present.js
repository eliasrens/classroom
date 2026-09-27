/**
 * "VISA PÅ ELEVSKÄRM" — statuslogiken (issue #88).
 *
 * En enda regel: knappen i elevskärmspanelen skickar ut EXAKT det
 * läraren tittar på — läget OCH lägets "sak" (vilken lektionsplanering,
 * vilken tankekarta). Ingenting ändras för eleverna förrän läraren
 * trycker igen.
 *
 * Ett läge med "flera saker" rapporterar sitt val till storen som
 * `presentSpot` medan det är monterat i lärarvyn:
 *
 *   { modeId,                          // lägets id
 *     current:   { id, label } | null, // det läraren tittar på just nu
 *     presented: { id, label } | null } // det som senast skickades ut
 *
 * null (inget spot, eller annat modeId) = läget har inget val — då räcker
 * det att läget är detsamma. Ett läge utan val (Trafikljus, Skrivtavla …)
 * sätter aldrig något spot. Läget nollställer spotet i unmount.
 *
 * Panelen (js/ui/student-panel.js) räknar ut färgen härifrån:
 *   grön  = eleverna ser exakt det läraren tittar på
 *   guld  = eleverna ser något annat (annat läge, annan planering/karta)
 */

/**
 * Ser eleverna EXAKT det läraren tittar på?
 * `modeId` = lärarens flik, `presentedMode` = utskickat läge,
 * `spot` = det monterade lägets rapport (se ovan).
 */
export function isExactlyPresented({ modeId, presentedMode, spot }) {
  if (!modeId || modeId !== presentedMode) return false;
  if (!spot || spot.modeId !== modeId) return true; // läge utan "flera saker"
  return (spot.current?.id ?? null) === (spot.presented?.id ?? null);
}

/**
 * Raden "Eleverna ser: …" i panelen — "Lektionsplanering · Bråk intro".
 * Sakens namn läggs bara till när det monterade läget är det utskickade
 * (annars vet vi bara läget). `modeTitle` = det utskickade lägets titel.
 */
export function presentedLabel({ presentedMode, modeTitle, spot }) {
  if (!presentedMode || !modeTitle) return null;
  const item = spot && spot.modeId === presentedMode ? spot.presented : null;
  return item?.label ? `${modeTitle} · ${item.label}` : modeTitle;
}
