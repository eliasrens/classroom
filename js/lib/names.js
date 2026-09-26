/**
 * NAMNVISNING — elever bär ENDAST förnamn (se DATAMODELL.md).
 *
 * Ett elevdokument har `firstName` och ett valfritt kort `tag`
 * (emoji/bokstav/siffra) som läraren KAN sätta om två elever delar
 * förnamn — aldrig något efternamnsfält.
 *
 * Namn visas alltid som förnamn (plus `tag`). Det tidigare
 * initial-läget (settings/display) är borttaget (issue #60).
 */

/**
 * Visningsnamn för en elev.
 *   studentLabel({firstName:"Elsa", tag:"🐱"}) → "Elsa 🐱"
 */
export function studentLabel(student) {
  const base = student?.firstName ?? "?";
  return student?.tag ? `${base} ${student.tag}` : base;
}

/** Id för det borttagna initial-lägets inställning (classes/{cid}/settings/display). */
export const LEGACY_DISPLAY_SETTING_ID = "display";

/**
 * Städsteg (issue #60): ta bort ett kvarglömt settings/display ur klassens
 * inställningar. Idempotent — gör inget om dokumentet saknas. Dokumentet
 * läses aldrig längre, så det är ofarligt om städningen inte hinner köras.
 */
export async function removeLegacyNameDisplay(data, cid, settingsDocs) {
  if (!cid || !settingsDocs?.some((d) => d.id === LEGACY_DISPLAY_SETTING_ID)) return false;
  await data.remove(`classes/${cid}/settings`, LEGACY_DISPLAY_SETTING_ID);
  return true;
}
