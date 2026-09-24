/**
 * KLASSER — skapande utan dubbletter.
 *
 * Historik: "4B" fanns två gånger i Firestore. Orsaken var att varje
 * enhet som skapade en klass gav den ett SLUMPAT id (crypto.randomUUID
 * i datalagret). Skapade två enheter "4B" — eller en enhet innan den
 * hunnit få första server-snapshoten — blev det två olika dokument som
 * båda synkades upp, och merge-logiken (per dokument-id) kan aldrig slå
 * ihop dem.
 *
 * Fixen är tvådelad och stänger båda vägarna:
 *  1. Finns redan en klass med samma namn (skiftlägesokänsligt) återanvänds
 *     den i stället för att en ny skapas.
 *  2. Nya klasser får ett DETERMINISTISKT id härlett ur namnet
 *     ("4B" → "4b"). Två enheter som skapar "4B" oberoende av varandra —
 *     även offline, innan de sett varandras data — skriver då samma
 *     dokument, och synken blir idempotent i stället för duplicerande.
 *
 * Samma namn = samma klass är appens semantik (klassnamnet är det enda
 * läraren anger), så id-kollisioner mellan OLIKA klasser kan inte uppstå.
 * Befintliga klasser med UUID-id fortsätter fungera oförändrat (steg 1
 * hittar dem på namnet).
 */

/** Normaliserat klassnamn för jämförelse: "  4b " ≈ "4B". */
const normName = (name) => String(name ?? "").trim().toLocaleLowerCase("sv");

/** Deterministiskt dokument-id ur klassnamnet: "4B" → "4b", "Åk 4:B" → "åk-4-b". */
export function classIdFor(name) {
  return normName(name).replace(/[^a-z0-9åäö]+/g, "-").replace(/^-+|-+$/g, "") || "klass";
}

/**
 * Skapa (eller återanvänd) en klass med givet namn. Returnerar klassens id,
 * eller null om namnet är tomt. Dubbleras aldrig: samma namn ger alltid
 * samma klass.
 */
export async function createClass(data, name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return null;
  const existing = (await data.list("classes")).find((c) => normName(c.name) === normName(trimmed));
  if (existing) return existing.id;
  return data.put("classes", { id: classIdFor(trimmed), name: trimmed });
}
