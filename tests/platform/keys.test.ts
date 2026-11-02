// T-005: envelope encryption round-trip, tenant/purpose binding, KEK and DEK rotation,
// blind index, and KEK file custody checks.
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  blindIndex,
  decryptField,
  dekVersionOf,
  encryptField,
  KeyError,
  kekVersionOf,
  type KekRing,
  newWrappedDek,
  rewrapDek,
  type TenantKeys,
  type WrappedDek,
} from "../../src/lib/keys/envelope";
import { loadKekRing, parseKekRing } from "../../src/lib/keys/kek-file";

const ring = (current: number, ...versions: number[]): KekRing => ({
  current,
  keys: new Map(versions.map((v) => [v, keyFor(v)])),
});
const kekBytes = new Map<number, Buffer>();
function keyFor(v: number): Buffer {
  if (!kekBytes.has(v)) kekBytes.set(v, randomBytes(32));
  return kekBytes.get(v)!;
}

function tenantKeys(tenantId: string, ...deks: WrappedDek[]): TenantKeys {
  return {
    tenantId,
    current: deks[deks.length - 1],
    byVersion: (v) => deks.find((d) => d.version === v),
  };
}

const tenantA = randomUUID();
const tenantB = randomUUID();
const NIK = "3171012345678901"; // synthetic

describe("envelope encryption", () => {
  const r1 = ring(1, 1);
  const dekA = newWrappedDek(r1, tenantA, 1);
  const keysA = tenantKeys(tenantA, dekA);

  it("round-trips a field and never stores plaintext", () => {
    const c = encryptField(r1, keysA, "patient.nik", NIK);
    expect(c).not.toContain(NIK);
    expect(c.startsWith("v1.1.")).toBe(true);
    expect(decryptField(r1, keysA, "patient.nik", c)).toBe(NIK);
  });

  it("uses a fresh IV: equal plaintexts give different ciphertexts", () => {
    expect(encryptField(r1, keysA, "patient.nik", NIK)).not.toBe(
      encryptField(r1, keysA, "patient.nik", NIK),
    );
  });

  it("binds a value to its purpose", () => {
    const c = encryptField(r1, keysA, "patient.nik", NIK);
    expect(() => decryptField(r1, keysA, "staff.nik", c)).toThrow(KeyError);
  });

  it("binds a value to its tenant: B's keys cannot open A's value", () => {
    const dekB = newWrappedDek(r1, tenantB, 1);
    const c = encryptField(r1, keysA, "patient.nik", NIK);
    expect(() => decryptField(r1, tenantKeys(tenantB, dekB), "patient.nik", c)).toThrow(KeyError);
  });

  it("refuses to encrypt or index with another tenant's current DEK", () => {
    const dekB = newWrappedDek(r1, tenantB, 1);
    const mixed: TenantKeys = { tenantId: tenantA, current: dekB, byVersion: () => dekB };
    expect(() => encryptField(r1, mixed, "patient.nik", NIK)).toThrow("not available for this tenant");
    expect(() => blindIndex(r1, mixed, "patient.nik", NIK)).toThrow("not available for this tenant");
  });

  it("refuses a DEK whose version differs from the one in the value", () => {
    const d1 = newWrappedDek(r1, tenantA, 1);
    const d2 = newWrappedDek(r1, tenantA, 2);
    const v = encryptField(r1, tenantKeys(tenantA, d1), "patient.nik", NIK);
    const lying: TenantKeys = { tenantId: tenantA, current: d2, byVersion: () => d2 };
    expect(() => decryptField(r1, lying, "patient.nik", v)).toThrow("version 1 is not available");
  });

  it("validates tenant ids and purposes used in AAD", () => {
    expect(() => newWrappedDek(r1, "a|b", 1)).toThrow("tenantId");
    expect(() => encryptField(r1, keysA, "patient|nik", NIK)).toThrow("purpose");
    expect(() => encryptField(r1, keysA, "Patient.NIK", NIK)).toThrow("purpose");
  });

  it("binds a wrapped DEK to its tenant: relabelling it fails", () => {
    const stolen = { ...dekA, tenantId: tenantB };
    const c = encryptField(r1, keysA, "patient.nik", NIK);
    expect(() => decryptField(r1, tenantKeys(tenantB, stolen), "patient.nik", c)).toThrow(KeyError);
  });

  it("detects tampering", () => {
    const c = encryptField(r1, keysA, "patient.nik", NIK).split(".");
    const ct = Buffer.from(c[3], "base64url");
    ct[0] ^= 1;
    c[3] = ct.toString("base64url");
    expect(() => decryptField(r1, keysA, "patient.nik", c.join("."))).toThrow(KeyError);
    expect(() => decryptField(r1, keysA, "patient.nik", "v1.1.x")).toThrow("malformed");
  });

  it("refuses a KEK of the wrong size", () => {
    const bad: KekRing = { current: 1, keys: new Map([[1, randomBytes(16)]]) };
    expect(() => newWrappedDek(bad, tenantA, 1)).toThrow("KEK must be 32 bytes");
  });
});

describe("key rotation", () => {
  it("KEK rotation rewraps DEKs; old field ciphertexts still decrypt; old KEK can then be retired", () => {
    const r1 = ring(1, 1);
    const dek = newWrappedDek(r1, tenantA, 1);
    const value = encryptField(r1, tenantKeys(tenantA, dek), "patient.nik", NIK);

    const r12 = ring(2, 1, 2); // new KEK loaded beside the old one
    const rewrapped = rewrapDek(r12, dek);
    expect(kekVersionOf(dek)).toBe(1);
    expect(kekVersionOf(rewrapped)).toBe(2);
    expect(rewrapped.wrapped).not.toBe(dek.wrapped);

    const r2 = ring(2, 2); // KEK 1 retired
    expect(decryptField(r2, tenantKeys(tenantA, rewrapped), "patient.nik", value)).toBe(NIK);
    expect(() => decryptField(r2, tenantKeys(tenantA, dek), "patient.nik", value)).toThrow(
      "KEK version 1 is not loaded",
    );
  });

  it("DEK rotation: new values use the new DEK, old values keep decrypting with theirs", () => {
    const r = ring(1, 1);
    const d1 = newWrappedDek(r, tenantA, 1);
    const old = encryptField(r, tenantKeys(tenantA, d1), "patient.nik", NIK);
    const d2 = newWrappedDek(r, tenantA, 2);
    const keys = tenantKeys(tenantA, d1, d2);
    const fresh = encryptField(r, keys, "patient.nik", NIK);
    expect(dekVersionOf(old)).toBe(1);
    expect(dekVersionOf(fresh)).toBe(2);
    expect(decryptField(r, keys, "patient.nik", old)).toBe(NIK);
    expect(decryptField(r, keys, "patient.nik", fresh)).toBe(NIK);
    // Re-encrypting old values moves them to the current DEK.
    const migrated = encryptField(r, keys, "patient.nik", decryptField(r, keys, "patient.nik", old));
    expect(dekVersionOf(migrated)).toBe(2);
  });

  it("a DEK version missing from the tenant's set fails closed", () => {
    const r = ring(1, 1);
    const d1 = newWrappedDek(r, tenantA, 1);
    const d2 = newWrappedDek(r, tenantA, 2);
    const v = encryptField(r, tenantKeys(tenantA, d1, d2), "patient.nik", NIK);
    expect(() => decryptField(r, tenantKeys(tenantA, d1), "patient.nik", v)).toThrow(
      "data key version 2 is not available",
    );
  });
});

describe("blind index", () => {
  const r = ring(1, 1, 2);
  const dekA = newWrappedDek(r, tenantA, 1);
  const dekB = newWrappedDek(r, tenantB, 1);
  const kA = tenantKeys(tenantA, dekA);

  it("is deterministic per tenant and purpose, and differs across tenants and purposes", () => {
    const a1 = blindIndex(r, kA, "patient.nik", NIK);
    expect(blindIndex(r, kA, "patient.nik", NIK)).toBe(a1);
    expect(blindIndex(r, tenantKeys(tenantB, dekB), "patient.nik", NIK)).not.toBe(a1);
    expect(blindIndex(r, kA, "staff.nik", NIK)).not.toBe(a1);
    expect(a1).not.toContain(NIK);
  });

  it("survives KEK rotation", () => {
    const before = blindIndex(r, kA, "patient.nik", NIK);
    const rewrapped = rewrapDek({ current: 2, keys: r.keys }, dekA);
    expect(blindIndex(r, tenantKeys(tenantA, rewrapped), "patient.nik", NIK)).toBe(before);
  });
});

describe("KEK file custody (ARCH-7)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kek-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const line = (v: number) => `${v}:${randomBytes(32).toString("base64")}`;

  function write(name: string, text: string, mode: number): string {
    const p = join(dir, name);
    writeFileSync(p, text);
    chmodSync(p, mode);
    return p;
  }

  it("loads a 0400 file; current is the declared version, so a staged key is unused", () => {
    const ring = loadKekRing(write("ok", `# comment\n${line(1)}\n${line(3)}\ncurrent=1\n`, 0o400));
    expect(ring.current).toBe(1);
    expect([...ring.keys.keys()]).toEqual([1, 3]);
  });

  it("refuses group- or world-readable files", () => {
    expect(() => loadKekRing(write("open", `${line(1)}\ncurrent=1`, 0o640))).toThrow("too open");
    expect(() => loadKekRing(write("world", `${line(1)}\ncurrent=1`, 0o604))).toThrow("too open");
  });

  it("refuses symlinks", () => {
    const target = write("target", `${line(1)}\ncurrent=1`, 0o400);
    const link = join(dir, "link");
    symlinkSync(target, link);
    expect(() => loadKekRing(link)).toThrow("symlink");
  });

  it("refuses malformed, duplicate, short or empty rings and a bad current", () => {
    expect(() => parseKekRing("1:short")).toThrow("malformed");
    const l = line(1);
    expect(() => parseKekRing(`${l}\n${l}`)).toThrow("appears twice");
    expect(() => parseKekRing("# nothing\n")).toThrow("no keys");
    expect(() => parseKekRing(`0:${randomBytes(32).toString("base64")}`)).toThrow("malformed");
    expect(() => parseKekRing(l)).toThrow("no current");
    expect(() => parseKekRing(`${l}\ncurrent=2`)).toThrow("not in the file");
    expect(() => parseKekRing(`${l}\ncurrent=1\ncurrent=1`)).toThrow("current twice");
  });
});
