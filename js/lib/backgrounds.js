/**
 * MORGONSKÄRMENS BAKGRUNDER (issue #64) — bildkatalog + ren logik.
 *
 * Bilderna ligger i kategorier: de fyra årstiderna och "Platser i världen".
 * Alla är Unsplash-foton under Unsplash License (gratis, inte Unsplash+)
 * som hotlänkas från images.unsplash.com, precis som tidigare. Varje id är
 * kontrollerat (svarar 200 och motivet stämmer). Fotograferna står i
 * docs/BAKGRUNDER.md.
 *
 * Slumpen (vid sidladdning och knappen "Slumpa") tar BARA bilder ur den
 * aktuella årstidens kategori — aldrig "Platser i världen" eller egna
 * bilder. Har läraren själv valt en bild i dag (background.pickedOn =
 * dagens datum) slumpas den inte bort vid omladdning; nästa dag slumpas
 * en ny årstidsbild som vanligt.
 *
 * Ingen DOM här — tål att köras i Node (docs/test-backgrounds.mjs).
 */

import { serverNow } from "./clock.js";

export const unsplashUrl = (id, width = 1920) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=80`;

/** Miniatyr för väljaren (samma foto, liten bredd). */
export const thumbUrl = (url) =>
  isUnsplash(url) ? url.replace(/([?&])w=\d+/, "$1w=320").replace(/([?&])q=\d+/, "$1q=60") : url;

const isUnsplash = (url) => typeof url === "string" && url.startsWith("https://images.unsplash.com/photo-");

// id = Unsplash-id, alt = motivbeskrivning (alt-text), by = fotograf.
// Platser: `place` är etiketten under miniatyren i väljaren.
export const BG_CATEGORIES = [
  {
    id: "host", label: "Höst", season: true,
    images: [
      { id: "1482015527294-7c8203fc9828", alt: "Å som slingrar sig genom en skog i höstfärger", by: "Noah Silliman" },
      { id: "1731617662729-cdde91663de9", alt: "Bergsdal i höstfärger", by: "iuliu illes" },
      { id: "1445855743215-296f71d4b49c", alt: "Skogsstig i gyllene kvällsljus", by: "Lukasz Szmigiel" },
      { id: "1508255139162-e1f7b7288ab7", alt: "Gyllene lärkträd under grå bergstoppar", by: "Federica Galli" },
      { id: "1635250164981-8205b58b11b0", alt: "Bänk vid en stilla sjö med höstskog och berg", by: "Martin Grazer" },
      { id: "1724344526531-5168ab8b034b", alt: "Allé med gula och bruna höstlöv", by: "Michael Hamments" },
      { id: "1701706413454-0d0dfe2d04b9", alt: "Gula träd som speglas i en sjö", by: "Evgeni Tcherkasski" },
      { id: "1698703302438-0e90680207ca", alt: "Dimmig sjö en höstmorgon", by: "Leandra Rieger" },
      { id: "1584148721201-b6432e0d5106", alt: "Bergsdal i gyllene höstljus", by: "Toan Chu" },
      { id: "1523712999610-f77fbcfc3843", alt: "Solstrålar genom en höstskog", by: "Johannes Plenio" },
    ],
  },
  {
    id: "vinter", label: "Vinter", season: true,
    images: [
      { id: "1638359662007-997ab22d68a0", alt: "Å genom en snötäckt skog", by: "Juho Luomala" },
      { id: "1614093643263-7ebf3d099724", alt: "Snötäckta granar framför berg", by: "Cristina Gottardi" },
      { id: "1577457943926-11193adc0563", alt: "Liten stuga i ett snölandskap", by: "simon" },
      { id: "1611004739509-f23bd5730705", alt: "Snötäckta granar i dimma", by: "Martin Grazer" },
      { id: "1640948410479-aeb6257e7f4a", alt: "Väg genom en snöig granskog", by: "Juho Luomala" },
      { id: "1485594050903-8e8ee7b071a8", alt: "Snötyngda granar mot blå himmel", by: "Stanley Dai" },
      { id: "1722682446067-5da6ad1fd00e", alt: "Snöfält och frostiga träd i rosa gryning", by: "Pietro Donà" },
      { id: "1480497490787-505ec076689f", alt: "Snöklädda berg som speglas i en sjö", by: "Tim Stief" },
      { id: "1704815737135-b0982904509f", alt: "Sol genom en snöig skog", by: "Pascal Debrunner" },
      { id: "1519681393784-d120267933ba", alt: "Snöklädda berg under stjärnhimmel", by: "Benjamin Voros" },
    ],
  },
  {
    id: "var", label: "Vår", season: true,
    images: [
      { id: "1462275646964-a0e3386b89fa", alt: "Körsbärsträd i blom", by: "Arno Smit" },
      { id: "1551272744-19456affaa89", alt: "Stig mellan blommande körsbärsträd", by: "Maud Bocquillod" },
      { id: "1681842220536-89efb94d3513", alt: "Rosa blommande gren mot blå himmel", by: "Anita Austvika" },
      { id: "1503919483171-9ffc1debc390", alt: "Prästkragar i motljus", by: "Daiga Ellaby" },
      { id: "1470240731273-7821a6eeb6bd", alt: "Blomsteräng i solsken", by: "Joel Holland" },
      { id: "1713439340151-6f1e7f6fb9c9", alt: "Vildblommor på en äng framför berg", by: "Claudio Biesele" },
      { id: "1590252497923-3c2b38e85d37", alt: "Ensamt träd på en blommande äng", by: "Lukas Gächter" },
      { id: "1472214103451-9374bd1c798e", alt: "Gröna kullar i solnedgång", by: "Robert Lukeman" },
      { id: "1470071459604-3b5ec3a7fe05", alt: "Grön dal med dimma över bergen", by: "v2osk" },
      { id: "1518495973542-4542c06a5843", alt: "Sol genom lövträdets grenar", by: "" },
    ],
  },
  {
    id: "sommar", label: "Sommar", season: true,
    images: [
      { id: "1439066615861-d1af74d74000", alt: "Brygga vid en stilla sjö", by: "Aaron Burden" },
      { id: "1441974231531-c6227db76b6e", alt: "Solig skog", by: "Lukasz Szmigiel" },
      { id: "1508500709478-37a0e8d6603c", alt: "Sjö med tallskog en sommarkväll", by: "Inès d'Anselme" },
      { id: "1733849593382-3d06b5e97adc", alt: "Röda hus vid en skogssjö", by: "Pat Rindone" },
      { id: "1704032359617-2f21c305744a", alt: "Sommaräng med havet i fjärran", by: "Jonas Päivärinta" },
      { id: "1499002238440-d264edd596ec", alt: "Lavendelfält i solnedgång", by: "Léonard Cotte" },
      { id: "1501785888041-af3ef285b470", alt: "Båt på en turkos bergssjö", by: "Pietro De Grandi" },
      { id: "1447752875215-b2761acb3c5d", alt: "Bro genom en grönskande skog", by: "" },
      { id: "1469474968028-56623f02e42e", alt: "Bergslandskap i solljus", by: "Urban Vintage" },
      { id: "1506905925346-21bda4d32df4", alt: "Bergstoppar ovanför molnen", by: "Sam Ferrara" },
      { id: "1426604966848-d7adac402bff", alt: "Dal med höga tallar och granitberg", by: "Adam Kool" },
    ],
  },
  {
    id: "platser", label: "Platser i världen", season: false,
    images: [
      { id: "1508804185872-d7badad00f7d", place: "Kinesiska muren", alt: "Kinesiska muren, Kina", by: "Hanson Lu" },
      { id: "1551171129-8ce1ebb911b3", place: "Petra", alt: "Petra, Jordanien", by: "Andrea Leopardi" },
      { id: "1552832230-c0197dd311b5", place: "Colosseum", alt: "Colosseum, Rom, Italien", by: "David Köhler" },
      { id: "1518638150340-f706e86654de", place: "Chichén Itzá", alt: "Chichén Itzá, Mexiko", by: "Marv Watson" },
      { id: "1587595431973-160d0d94add1", place: "Machu Picchu", alt: "Machu Picchu, Peru", by: "Eddie Kiszka" },
      { id: "1564507592333-c60657eea523", place: "Taj Mahal", alt: "Taj Mahal, Indien", by: "Jovyn Chamb" },
      { id: "1516306580123-e6e52b1b7b5f", place: "Kristusstatyn", alt: "Kristusstatyn, Rio de Janeiro, Brasilien", by: "Raphael Nogueira" },
      { id: "1539650116574-8efeb43e2750", place: "Pyramiderna i Giza", alt: "Pyramiderna i Giza, Egypten", by: "Leonardo Ramos" },
      { id: "1527004013197-933c4bb611b3", place: "Lofoten", alt: "Röda stugor på Lofoten, Norge", by: "John O'Nolan" },
      { id: "1513519107127-1bed33748e4c", place: "Norsk fjord", alt: "Fjord mellan branta berg, Norge", by: "Krisjanis Mezulis" },
      { id: "1555400038-63f5ba517a47", place: "Risterrasser, Bali", alt: "Risterrasser på Bali, Indonesien", by: "Niklas Weiss" },
      { id: "1537083702767-42f85f12834f", place: "Manarola", alt: "Manarola, Cinque Terre, Italien", by: "Justin Owens" },
      { id: "1528127269322-539801943592", place: "Ha Long-bukten", alt: "Ha Long-bukten, Vietnam", by: "Ammie Ngo" },
      { id: "1611522135886-a632d94ff6ae", place: "Sanddyner", alt: "Sanddyner i öknen", by: "Dylan Jenkinson" },
    ],
  },
];

/** Alla Unsplash-id:n i katalogen (platt lista). */
export const UNSPLASH_IDS = BG_CATEGORIES.flatMap((c) => c.images.map((i) => i.id));

const SEASON_BY_MONTH = [
  "vinter", "vinter", "var", "var", "var", "sommar",
  "sommar", "sommar", "host", "host", "host", "vinter",
]; // jan … dec: höst sep–nov, vinter dec–feb, vår mar–maj, sommar jun–aug

/** Årstidens kategori-id ("host" | "vinter" | "var" | "sommar") för en tidpunkt. */
export function seasonFor(now = serverNow()) {
  return SEASON_BY_MONTH[new Date(now).getMonth()];
}

export const categoryById = (id) => BG_CATEGORIES.find((c) => c.id === id) ?? null;

/** Bild-URL:er i en kategori (i katalogens ordning). */
export function categoryUrls(categoryId) {
  return (categoryById(categoryId)?.images ?? []).map((i) => unsplashUrl(i.id));
}

/** Katalogposten för en bakgrunds-URL (null för egna bilder/okända). */
export function findImage(url) {
  if (!isUnsplash(url)) return null;
  const m = /photo-([0-9]+-[0-9a-f]+)/.exec(url);
  if (!m) return null;
  for (const c of BG_CATEGORIES) {
    const img = c.images.find((i) => i.id === m[1]);
    if (img) return { category: c.id, ...img };
  }
  return null;
}

/**
 * Slumpa en bild ur ÅRSTIDENS kategori (aldrig Platser/egna). Undviker
 * den nuvarande bilden så att "Slumpa" alltid byter. `rand` kan bytas ut
 * i test.
 */
export function pickSeasonBg(current, now = serverNow(), rand = Math.random) {
  const pool = categoryUrls(seasonFor(now));
  const others = pool.filter((u) => u !== current);
  const choose = others.length ? others : pool;
  return choose[Math.floor(rand() * choose.length)] ?? "";
}

/** Lokalt datum "ÅÅÅÅ-MM-DD" (svensk skoldag, inte UTC). */
export function dayKey(now = serverNow()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Har läraren själv valt dagens bild? Då ska den inte slumpas bort. */
export function pickedToday(background, now = serverNow()) {
  return !!background?.current && background?.pickedOn === dayKey(now);
}

/**
 * Ska bakgrunden slumpas automatiskt vid sidladdning?
 *  - aldrig om läraren valt en bild i dag,
 *  - annars om ingen bild finns, eller första gången i den här sessionen.
 */
export function shouldAutoRandomize(background, { firstInSession }, now = serverNow()) {
  if (pickedToday(background, now)) return false;
  return !background?.current || !!firstInSession;
}
