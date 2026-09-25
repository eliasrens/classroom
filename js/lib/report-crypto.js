/**
 * KRYPTERADE RAPPORTFILER (.klassrum) — issue #33.
 *
 * Allt sker i webbläsaren med WebCrypto — inget nätverk, inga bibliotek:
 *   nyckel  = PBKDF2-SHA-256(lösenord, slumpad salt, ≥ 600 000 iterationer) → AES-GCM 256
 *   chiffer = AES-GCM med slumpad IV (12 byte) per fil
 * Lösenordet sparas ALDRIG. Tappas det går filen inte att öppna.
 *
 * Filformat (container version 1):
 *   "KLASSRUM"            8 byte  magiska tecken
 *   version               1 byte  containerversion (1)
 *   headerLängd           4 byte  uint32, big endian
 *   header                JSON (UTF-8) — kdf, chiffer och en kort META
 *   chiffertext           resten (AES-GCM, inkl. 16 byte autentiseringstagg)
 *
 * Allt före chiffertexten används som AES-GCM:s "additional data", så
 * en ändrad header (t.ex. manipulerad meta) gör att filen inte går att
 * öppna. META är det enda som står i klartext: vem som exporterat
 * (lärarens namn), klassnamn, period och antal elever — så att
 * öppningsdialogen kan visa "Catalin, v.39, 4A" innan lösenordet
 * skrivs. ALDRIG elevnamn, noteringstext eller annan elevdata.
 *
 * Modulen rör inte DOM och fungerar i Node ≥ 20 (docs/test-report.mjs).
 */

export const FILE_EXT = ".klassrum";
export const MIME = "application/x-klassrum";
export const CONTAINER_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 10;

const MAGIC = "KLASSRUM";
const PREFIX_LEN = MAGIC.length + 1 + 4;
// Skydd mot trasiga/elaka filer: rimliga gränser för kdf-parametrarna.
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
const MAX_HEADER_BYTES = 64 * 1024;

/** Fel vid öppning. code: "not-klassrum" | "newer-version" | "wrong-password" | "corrupt" | "no-crypto" */
export class ReportFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReportFileError";
    this.code = code;
  }
}

/** Vänliga felmeddelanden per kod (visas per fil i öppningsdialogen). */
export const ERROR_TEXT = {
  "not-klassrum": "Det här är ingen rapportfil från Klassrumsverktyget.",
  "newer-version": "Filen är skapad i en nyare version av appen. Ladda om sidan (eller uppdatera appen) och försök igen.",
  "wrong-password": "Fel lösenord — eller så är filen skadad. Kontrollera lösenordet och försök igen.",
  "corrupt": "Filen är skadad eller ofullständig och går inte att läsa.",
  "no-crypto": "Webbläsaren kan inte kryptera här. Öppna appen via https (eller localhost) och försök igen.",
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new ReportFileError("no-crypto", ERROR_TEXT["no-crypto"]);
  return s;
}

/** Finns WebCrypto (kräver säker kontext: https eller localhost)? */
export function cryptoAvailable() {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues);
}

export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(String(b64));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(password, salt, iterations, usage) {
  const base = await subtle().importKey("raw", enc.encode(String(password).normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

/**
 * Kryptera en rapport (valfritt JSON-värde) med ett lösenord.
 * meta: kort klartextbeskrivning UTAN elevdata (se modulkommentaren).
 * → Uint8Array (hela filen).
 */
export async function encryptReport(payload, password, { meta = {}, iterations = PBKDF2_ITERATIONS } = {}) {
  if (String(password ?? "").length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    v: CONTAINER_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: toBase64(salt) },
    cipher: { name: "AES-GCM", length: 256, iv: toBase64(iv) },
    meta,
  };
  const headerBytes = enc.encode(JSON.stringify(header));
  const prefix = new Uint8Array(PREFIX_LEN + headerBytes.length);
  prefix.set(enc.encode(MAGIC), 0);
  prefix[MAGIC.length] = CONTAINER_VERSION;
  new DataView(prefix.buffer).setUint32(MAGIC.length + 1, headerBytes.length, false);
  prefix.set(headerBytes, PREFIX_LEN);

  const key = await deriveKey(password, salt, iterations, "encrypt");
  const plain = enc.encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: prefix }, key, plain));

  const out = new Uint8Array(prefix.length + cipher.length);
  out.set(prefix, 0);
  out.set(cipher, prefix.length);
  return out;
}

/**
 * Läs filens klartextdel utan lösenord → { version, header, meta, prefixLength }.
 * Kastar ReportFileError ("not-klassrum" | "newer-version" | "corrupt").
 */
export function readReportHeader(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < PREFIX_LEN || dec.decode(b.subarray(0, MAGIC.length)) !== MAGIC) {
    throw new ReportFileError("not-klassrum", ERROR_TEXT["not-klassrum"]);
  }
  const version = b[MAGIC.length];
  if (version > CONTAINER_VERSION) throw new ReportFileError("newer-version", ERROR_TEXT["newer-version"]);
  if (version < 1) throw new ReportFileError("corrupt", ERROR_TEXT.corrupt);
  const len = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(MAGIC.length + 1, false);
  if (len > MAX_HEADER_BYTES || PREFIX_LEN + len >= b.length) throw new ReportFileError("corrupt", ERROR_TEXT.corrupt);
  let header;
  try {
    header = JSON.parse(dec.decode(b.subarray(PREFIX_LEN, PREFIX_LEN + len)));
  } catch {
    throw new ReportFileError("corrupt", ERROR_TEXT.corrupt);
  }
  const it = header?.kdf?.iterations;
  if (header?.kdf?.name !== "PBKDF2" || header?.kdf?.hash !== "SHA-256" || header?.cipher?.name !== "AES-GCM"
      || !Number.isInteger(it) || it < MIN_ITERATIONS || it > MAX_ITERATIONS
      || typeof header.kdf.salt !== "string" || typeof header.cipher.iv !== "string") {
    throw new ReportFileError("corrupt", ERROR_TEXT.corrupt);
  }
  return { version, header, meta: header.meta ?? {}, prefixLength: PREFIX_LEN + len };
}

/**
 * Dekryptera en .klassrum-fil → det ursprungliga JSON-värdet.
 * Fel lösenord (eller manipulerad fil) → ReportFileError("wrong-password").
 */
export async function decryptReport(bytes, password) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { header, prefixLength } = readReportHeader(b);
  let salt, iv;
  try {
    salt = fromBase64(header.kdf.salt);
    iv = fromBase64(header.cipher.iv);
  } catch {
    throw new ReportFileError("corrupt", ERROR_TEXT.corrupt);
  }
  const key = await deriveKey(password ?? "", salt, header.kdf.iterations, "decrypt");
  let plain;
  try {
    plain = await subtle().decrypt(
      { name: "AES-GCM", iv, additionalData: b.subarray(0, prefixLength) },
      key,
      b.subarray(prefixLength),
    );
  } catch {
    throw new ReportFileError("wrong-password", ERROR_TEXT["wrong-password"]);
  }
  try {
    return JSON.parse(dec.decode(plain));
  } catch {
    throw new ReportFileError("corrupt", ERROR_TEXT.corrupt);
  }
}

// ---- Lösenordsstyrka ----

const COMMON = ["lösenord", "losenord", "password", "qwerty", "123456", "abc123", "klassrum", "skolan", "hejhej", "sommar", "vinter"];

/**
 * Enkel styrkemätare (0–4) med en kort text. Inte en exakt entropiberäkning
 * — den ska få läraren att välja ett längre lösenord, gärna en fras.
 * → { score, label, ok } där ok = uppfyller minimikravet (≥ 10 tecken).
 */
export function passwordStrength(pw) {
  const s = String(pw ?? "");
  const len = [...s].length;
  if (len === 0) return { score: 0, label: "Inget lösenord", ok: false };
  const classes = [/[a-zåäö]/, /[A-ZÅÄÖ]/, /\d/, /[^A-Za-zÅÄÖåäö\d]/].filter((re) => re.test(s)).length;
  const unique = new Set(s.toLowerCase()).size;
  let bits = len * Math.log2(Math.max(10, [0, 26, 52, 62, 90][classes]));
  if (unique < len / 2) bits *= 0.6;                         // mycket upprepning
  if (/(.)\1{2,}/.test(s)) bits *= 0.8;                      // aaa, 111
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/i.test(s)) bits *= 0.7;
  if (COMMON.some((w) => s.toLowerCase().includes(w))) bits *= 0.6;
  if (/\s/.test(s.trim()) && len >= 16) bits += 10;          // lösenfras med flera ord
  const ok = len >= MIN_PASSWORD_LENGTH;
  let score = bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  if (!ok) score = Math.min(score, 1);
  const label = !ok
    ? `För kort — minst ${MIN_PASSWORD_LENGTH} tecken`
    : ["Mycket svagt", "Svagt", "Godkänt", "Bra", "Starkt"][score];
  return { score, label, ok };
}
