import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Crockford-style alphabet without look-alike characters (no 0/O, 1/I/L).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomCode(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Human-readable case id, e.g. CP-7K3M-Q9TD. */
export function newCaseId(): string {
  const code = randomCode(8);
  return `CP-${code.slice(0, 4)}-${code.slice(4)}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomCode(10).toLowerCase()}`;
}

/** Owner key returned once at report time; only its hash is stored. */
export function newOwnerKey(): string {
  return randomBytes(24).toString("base64url");
}

export function sha256Hex(data: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function ownerKeyMatches(key: string | null | undefined, hash: string): boolean {
  if (!key) return false;
  const a = Buffer.from(sha256Hex(key), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
