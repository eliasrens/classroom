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
