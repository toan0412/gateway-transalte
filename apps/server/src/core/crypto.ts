import {
  createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual,
} from "node:crypto";

export function deriveKey(masterKey: string): Buffer {
  return createHash("sha256").update(`tg-master:${masterKey}`).digest();
}

/** AES-256-GCM; định dạng: base64(iv | tag | ciphertext) */
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function decrypt(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, "base64");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
