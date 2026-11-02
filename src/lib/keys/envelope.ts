// Envelope encryption (ARCH-7, DATA-8, TEN-7). A key-encryption key (KEK) wraps one data
// key per tenant (DEK); DEKs encrypt fields (NIK, provider tokens, registration PINs).
// AES-256-GCM from node:crypto; every ciphertext is bound by AAD to its tenant, its
// purpose and the key versions, so a value cannot be moved to another tenant or field.
// Key buffers are zeroed after use on a best-effort basis (the KEK ring and decoded
// strings stay in the heap for the process lifetime).
//
// Formats (base64url parts, '.'-separated):
//   wrapped DEK: "k1.<kekVersion>.<iv>.<ciphertext>.<tag>"
//   field value: "v1.<dekVersion>.<iv>.<ciphertext>.<tag>"
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const ALG = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class KeyError extends Error {}

export type Kek = { version: number; key: Buffer };

// KEK ring: the current version wraps new DEKs; older versions only unwrap until every
// DEK has been rewrapped (rotation). Rollout: load a new KEK on every instance first,
// then promote it to current (see kek-file.ts), so no instance wraps under a KEK that
// another instance cannot unwrap.
export type KekRing = { current: number; keys: ReadonlyMap<number, Buffer> };

export type WrappedDek = { tenantId: string; version: number; wrapped: string };

const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

function assertKey(key: Buffer, what: string): void {
  if (key.length !== KEY_BYTES) throw new KeyError(`${what} must be ${KEY_BYTES} bytes`);
}

function seal(key: Buffer, plaintext: Buffer, aad: string): [string, string, string] {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [b64(iv), b64(ct), b64(cipher.getAuthTag())];
}

function open(key: Buffer, iv: string, ct: string, tag: string, aad: string): Buffer {
  try {
    const decipher = createDecipheriv(ALG, key, unb64(iv));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(unb64(tag));
    return Buffer.concat([decipher.update(unb64(ct)), decipher.final()]);
  } catch {
    throw new KeyError("decryption failed (wrong key, tenant, purpose or tampered value)");
  }
}

function parts(value: string, prefix: string, n: number): string[] {
  const p = value.split(".");
  if (p.length !== n || p[0] !== prefix) throw new KeyError(`malformed ${prefix} value`);
  return p;
}

function version(s: string): number {
  if (!/^[1-9][0-9]{0,8}$/.test(s)) throw new KeyError("malformed key version");
  return Number(s);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PURPOSE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

// AAD fields are '|'-joined; tenant ids and purposes are restricted so no field can
// contain the separator.
function assertTenant(tenantId: string): void {
  if (!UUID.test(tenantId)) throw new KeyError("tenantId must be a lower-case UUID");
}
function assertPurpose(purpose: string): void {
  if (!PURPOSE.test(purpose)) throw new KeyError("purpose must look like 'patient.nik'");
}

// The DEK used for a tenant must belong to that tenant and carry the version asked for.
function checkedDek(tenantId: string, d: WrappedDek | undefined, version?: number): WrappedDek {
  if (!d || d.tenantId !== tenantId || (version !== undefined && d.version !== version)) {
    throw new KeyError(
      `data key version ${version ?? "current"} is not available for this tenant`,
    );
  }
  return d;
}

const dekAad = (tenantId: string, dekVersion: number, kekVersion: number) =>
  `dek|${tenantId}|${dekVersion}|${kekVersion}`;
const fieldAad = (tenantId: string, purpose: string, dekVersion: number) =>
  `field|${tenantId}|${purpose}|${dekVersion}`;

function kekFor(ring: KekRing, v: number): Buffer {
  const key = ring.keys.get(v);
  if (!key) throw new KeyError(`KEK version ${v} is not loaded`);
  assertKey(key, "KEK");
  return key;
}

// Creates a fresh DEK for a tenant, wrapped by the current KEK.
export function newWrappedDek(ring: KekRing, tenantId: string, dekVersion: number): WrappedDek {
  assertTenant(tenantId);
  if (!Number.isInteger(dekVersion) || dekVersion < 1) throw new KeyError("bad DEK version");
  const dek = randomBytes(KEY_BYTES);
  try {
    return wrapDek(ring, tenantId, dekVersion, dek);
  } finally {
    dek.fill(0);
  }
}

function wrapDek(ring: KekRing, tenantId: string, dekVersion: number, dek: Buffer): WrappedDek {
  const kek = kekFor(ring, ring.current);
  const [iv, ct, tag] = seal(kek, dek, dekAad(tenantId, dekVersion, ring.current));
  return { tenantId, version: dekVersion, wrapped: ["k1", ring.current, iv, ct, tag].join(".") };
}

export function unwrapDek(ring: KekRing, d: WrappedDek): Buffer {
  const [, kv, iv, ct, tag] = parts(d.wrapped, "k1", 5);
  const kekVersion = version(kv);
  return open(kekFor(ring, kekVersion), iv, ct, tag, dekAad(d.tenantId, d.version, kekVersion));
}

export function kekVersionOf(d: WrappedDek): number {
  return version(parts(d.wrapped, "k1", 5)[1]);
}

// KEK rotation: rewraps a DEK under the current KEK. Field ciphertexts are untouched.
export function rewrapDek(ring: KekRing, d: WrappedDek): WrappedDek {
  const dek = unwrapDek(ring, d);
  try {
    return wrapDek(ring, d.tenantId, d.version, dek);
  } finally {
    dek.fill(0);
  }
}

// Source of a tenant's DEKs: the current one encrypts, any version decrypts.
export type TenantKeys = {
  tenantId: string;
  current: WrappedDek;
  byVersion(version: number): WrappedDek | undefined;
};

export function encryptField(
  ring: KekRing,
  keys: TenantKeys,
  purpose: string,
  plaintext: string,
): string {
  assertTenant(keys.tenantId);
  assertPurpose(purpose);
  const current = checkedDek(keys.tenantId, keys.current);
  const dek = unwrapDek(ring, current);
  try {
    const [iv, ct, tag] = seal(
      dek,
      Buffer.from(plaintext, "utf8"),
      fieldAad(keys.tenantId, purpose, current.version),
    );
    return ["v1", current.version, iv, ct, tag].join(".");
  } finally {
    dek.fill(0);
  }
}

export function decryptField(ring: KekRing, keys: TenantKeys, purpose: string, value: string): string {
  assertTenant(keys.tenantId);
  assertPurpose(purpose);
  const [, dv, iv, ct, tag] = parts(value, "v1", 5);
  const dekVersion = version(dv);
  const wrapped = checkedDek(keys.tenantId, keys.byVersion(dekVersion), dekVersion);
  const dek = unwrapDek(ring, wrapped);
  try {
    return open(dek, iv, ct, tag, fieldAad(keys.tenantId, purpose, dekVersion)).toString("utf8");
  } finally {
    dek.fill(0);
  }
}

export function dekVersionOf(value: string): number {
  return version(parts(value, "v1", 5)[1]);
}

// Blind index for equality lookup (DATA-8): HMAC-SHA256 under a subkey derived from the
// tenant's current DEK per purpose, over the normalised value. Stable across KEK
// rotation; a DEK rotation needs a reindex for that purpose.
export function blindIndex(
  ring: KekRing,
  keys: TenantKeys,
  purpose: string,
  normalised: string,
): string {
  assertTenant(keys.tenantId);
  assertPurpose(purpose);
  const wrapped = checkedDek(keys.tenantId, keys.current);
  const dek = unwrapDek(ring, wrapped);
  try {
    const sub = Buffer.from(
      hkdfSync("sha256", dek, Buffer.alloc(0), `bidx|${wrapped.tenantId}|${purpose}`, KEY_BYTES),
    );
    try {
      return createHmac("sha256", sub).update(normalised, "utf8").digest("base64url");
    } finally {
      sub.fill(0);
    }
  } finally {
    dek.fill(0);
  }
}
