/**
 * NAMNVISNING — elever bär ENDAST förnamn (se DATAMODELL.md).
 *
 * Ett elevdokument har `firstName` och ett valfritt kort `tag`
 * (emoji/bokstav/siffra) som läraren KAN sätta om två elever delar
 * förnamn — aldrig något efternamnsfält.
 *
 * Initial-visningen är ett reservläge (togglas i lärarvyn, sparas i
 * klassens inställningar under nyckeln "display", se DATAMODELL.md):
 * initialer räknas alltid fram ur förnamnet — de lagras inte.
 */

/** "Anna-Lena" → "AL", "Bo" → "B". Tomt/ogiltigt → "?". */
export function initialsFor(firstName) {
  const parts = String(firstName ?? "").trim().split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.map((p) => [...p][0].toLocaleUpperCase("sv")).join("");
}

/**
 * Visningsnamn för en elev.
 *   studentLabel({firstName:"Elsa", tag:"🐱"})                    → "Elsa 🐱"
 *   studentLabel({firstName:"Elsa", tag:"🐱"}, {initials:true})  → "E 🐱"
 * `initials` hämtas typiskt från klassinställningen
 * settings/display → value.nameDisplay === "initials".
 */
export function studentLabel(student, { initials = false } = {}) {
  const base = initials ? initialsFor(student?.firstName) : (student?.firstName ?? "?");
  return student?.tag ? `${base} ${student.tag}` : base;
}
