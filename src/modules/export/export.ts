// Tenant export pure core (PR-52, UX-32, TEN-18, RATE-5, SEC-5; T-122).
// Closes Findings #2, #3, #4, #5, #6, #7 of t122/PLAN-REVIEW-codex-panel3.md:
// - Consumes real HYG-026 branded StepUp type from src/auth/server.ts (never forgeable object literals).
// - Canonical manifest binds (version, tenantId, exportId, generation, completedAt, files[]) deterministically.
// - Release verification checks sha256(manifest_json) === manifest_sha256, rejects duplicate paths,
//   missing/extra files, kind mismatches, and byte/hash tampering 1-to-1 before streaming a single byte.
// - Explicit pilot ceilings enforced before buffering: MAX_FILE_BYTES=20 MiB, MAX_TOTAL_BYTES=256 MiB, MAX_ENTRIES=10_000.
// - Decoupled purge plan: ready past expires_at -> expired+purged; failed past requested_at+24h -> purged keeping failed+error_code.
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import type { StepUp } from "../../auth/server";
import { CommandError, type ErrorCode } from "../../lib/command";

export type { StepUp };

export const EXPIRY_MS = 24 * 60 * 60 * 1000; // PR-52 Scenario: 24 hours from completed_at
export const RATE = { requests: 5, windowMs: 5 * 60 * 1000 } as const; // RATE-5: <= 5 per 5 min per user
export const MANIFEST_PATH = "manifest.json";
export const MAX_ATTEMPTS = 3;
// lazy: bytea in DB; upgrade = S3-compatible object-store adapter via ARCH-9 config when an export approaches pilot ceilings.
export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MiB
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024; // 256 MiB
export const MAX_ENTRIES = 10_000;

export const STATES = ["queued", "running", "ready", "failed", "expired"] as const;
export type ExportState = (typeof STATES)[number];
export const FILE_KINDS = ["fhir", "pdf", "csv", "media"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const EXPORTABLE_STATES = ["live", "suspended", "exit"] as const;

export type ExportFile = { path: string; kind: FileKind; bytes: Uint8Array };
export type ManifestEntry = { path: string; kind: FileKind; sha256: string; size: number };
export type Manifest = {
  version: 1;
  tenantId: string;
  exportId: string;
  generation: number;
  completedAt: string;
  files: ManifestEntry[];
};

export class ExportRuleError extends CommandError {
  constructor(code: ErrorCode, readonly reason: string) {
    super(code);
    this.message = `${code}: ${reason}`;
  }
}

export const sha256 = (b: Uint8Array | string): string =>
  createHash("sha256").update(typeof b === "string" ? Buffer.from(b, "utf8") : b).digest("hex");

const PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function safePath(p: string): boolean {
  return p.length <= 200 && PATH.test(p) && !p.split("/").some((s) => s === "." || s === "..") && p !== MANIFEST_PATH;
}

export function assertPilotCeilings(files: readonly { path: string; bytes: Uint8Array }[]): void {
  if (files.length > MAX_ENTRIES) {
    throw new ExportRuleError("ERR_INVALID_INPUT", "export_too_many_entries");
  }
  let total = 0;
  for (const f of files) {
    if (f.bytes.byteLength > MAX_FILE_BYTES) {
      throw new ExportRuleError("ERR_INVALID_INPUT", "export_file_too_large");
    }
    total += f.bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) {
      throw new ExportRuleError("ERR_INVALID_INPUT", "export_total_too_large");
    }
  }
}

export function buildManifest(o: {
  tenantId: string;
  exportId: string;
  generation: number;
  completedAt: Date;
  files: readonly ExportFile[];
}): Manifest {
  if (!Number.isInteger(o.generation) || o.generation < 1) {
    throw new ExportRuleError("ERR_INVALID_INPUT", "generation");
  }
  assertPilotCeilings(o.files);
  const seen = new Set<string>();
  for (const f of o.files) {
    if (!safePath(f.path)) throw new ExportRuleError("ERR_INVALID_INPUT", "invalid_path");
    if (!FILE_KINDS.includes(f.kind)) throw new ExportRuleError("ERR_INVALID_INPUT", "kind");
    if (seen.has(f.path)) throw new ExportRuleError("ERR_INVALID_INPUT", "duplicate_path");
    seen.add(f.path);
  }
  const files = [...o.files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => ({ path: f.path, kind: f.kind, sha256: sha256(f.bytes), size: f.bytes.byteLength }));
  return {
    version: 1,
    tenantId: o.tenantId,
    exportId: o.exportId,
    generation: o.generation,
    completedAt: o.completedAt.toISOString(),
    files,
  };
}

export function manifestJsonString(m: Manifest): string {
  const head = `{"version":1,"tenantId":${JSON.stringify(m.tenantId)},"exportId":${JSON.stringify(m.exportId)},"generation":${m.generation},"completedAt":${JSON.stringify(m.completedAt)},"files":[`;
  const rows = m.files.map((f) => `{"path":${JSON.stringify(f.path)},"kind":${JSON.stringify(f.kind)},"sha256":"${f.sha256}","size":${f.size}}`);
  return `${head}\n${rows.join(",\n")}\n]}\n`;
}

export function manifestBytes(m: Manifest): Uint8Array {
  return new TextEncoder().encode(manifestJsonString(m));
}

// Validates persisted manifest_json against persisted manifest_sha256 and expected tenant/export/generation (Finding #6).
export function parseVerifiedManifest(
  rawJson: string,
  expectedSha256: string,
  expected: { tenantId: string; exportId: string; generation: number },
): Manifest {
  if (!HEX64.test(expectedSha256) || sha256(rawJson) !== expectedSha256) {
    throw new ExportRuleError("ERR_VERSION_CONFLICT", "manifest_hash_mismatch");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new ExportRuleError("ERR_VERSION_CONFLICT", "manifest_invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ExportRuleError("ERR_VERSION_CONFLICT", "manifest_invalid_shape");
  }
  const o = parsed as Record<string, unknown>;
  if (
    o.version !== 1 ||
    o.tenantId !== expected.tenantId ||
    o.exportId !== expected.exportId ||
    o.generation !== expected.generation ||
    typeof o.completedAt !== "string" ||
    Number.isNaN(Date.parse(o.completedAt)) ||
    !Array.isArray(o.files)
  ) {
    throw new ExportRuleError("ERR_VERSION_CONFLICT", "manifest_identity_mismatch");
  }
  const seen = new Set<string>();
  const entries: ManifestEntry[] = [];
  for (const item of o.files) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ExportRuleError("ERR_VERSION_CONFLICT", "manifest_entry_invalid");
    }
    const e = item as Record<string, unknown>;
    if (
      typeof e.path !== "string" ||
      !safePath(e.path) ||
      seen.has(e.path) ||
      typeof e.kind !== "string" ||
      !(FILE_KINDS as readonly string[]).includes(e.kind) ||
      typeof e.sha256 !== "string" ||
      !HEX64.test(e.sha256) ||
      typeof e.size !== "number" ||
      !Number.isSafeInteger(e.size) ||
      e.size < 0 ||
      e.size > MAX_FILE_BYTES
    ) {
      throw new ExportRuleError("ERR_VERSION_CONFLICT", "manifest_entry_invalid");
    }
    seen.add(e.path);
    entries.push({ path: e.path, kind: e.kind as FileKind, sha256: e.sha256, size: e.size });
  }
  const m: Manifest = {
    version: 1,
    tenantId: expected.tenantId,
    exportId: expected.exportId,
    generation: expected.generation,
    completedAt: o.completedAt,
    files: entries,
  };
  if (manifestJsonString(m) !== rawJson) {
    throw new ExportRuleError("ERR_VERSION_CONFLICT", "manifest_non_canonical");
  }
  return m;
}

// Strict 1-to-1 verification of loaded file rows against the persisted verified manifest (Finding #6):
// catches missing rows, extra rows, duplicate paths, kind mismatch, size mismatch, and byte/hash tampering.
export function verifyManifest(m: Manifest, files: readonly ExportFile[]): string[] {
  const out: string[] = [];
  const byPath = new Map<string, ExportFile>();
  for (const f of files) {
    if (byPath.has(f.path)) {
      out.push(`duplicate ${f.path}`);
    } else {
      byPath.set(f.path, f);
    }
  }
  for (const e of m.files) {
    const f = byPath.get(e.path);
    if (!f) {
      out.push(`missing ${e.path}`);
    } else {
      if (f.kind !== e.kind) out.push(`kind_mismatch ${e.path}`);
      if (f.bytes.byteLength !== e.size || sha256(f.bytes) !== e.sha256) out.push(`changed ${e.path}`);
    }
    byPath.delete(e.path);
  }
  for (const p of byPath.keys()) out.push(`unlisted ${p}`);
  return out;
}

export const expiresAt = (completedAt: Date): Date => new Date(completedAt.getTime() + EXPIRY_MS);

export type DownloadDecision = { ok: true } | { ok: false; code: "ERR_EXPIRED" | "ERR_VERSION_CONFLICT"; reason: string };

export function canDownload(
  e: { state: ExportState; completedAt: Date | null; purgedAt?: Date | null; tenantState?: string },
  now: Date,
): DownloadDecision {
  if (e.tenantState && !(EXPORTABLE_STATES as readonly string[]).includes(e.tenantState)) {
    return { ok: false, code: "ERR_VERSION_CONFLICT", reason: `tenant_${e.tenantState}` };
  }
  if (e.state === "expired" || e.purgedAt) return { ok: false, code: "ERR_EXPIRED", reason: "expired" };
  if (e.state !== "ready" || !e.completedAt) return { ok: false, code: "ERR_VERSION_CONFLICT", reason: `not_ready:${e.state}` };
  if (now.getTime() >= expiresAt(e.completedAt).getTime()) return { ok: false, code: "ERR_EXPIRED", reason: "expired" };
  return { ok: true };
}

export type PurgeCandidate = {
  id: string;
  state: ExportState;
  completedAt: Date | null;
  requestedAt: Date;
  purgedAt: Date | null;
};

// Finding #5: ready exports past expires_at transition to expired+purged; failed exports past requestedAt+24h
// keep state='failed'+error_code and stamp purged_at while nulling staged bytes.
export function purgePlan(rows: readonly PurgeCandidate[], now: Date): { expireReady: string[]; purgeFailed: string[] } {
  const expireReady: string[] = [];
  const purgeFailed: string[] = [];
  for (const r of rows) {
    if (r.purgedAt !== null) continue;
    if (r.state === "ready" && r.completedAt !== null && now.getTime() >= expiresAt(r.completedAt).getTime()) {
      expireReady.push(r.id);
    } else if (r.state === "failed" && now.getTime() >= r.requestedAt.getTime() + EXPIRY_MS) {
      purgeFailed.push(r.id);
    }
  }
  expireReady.sort();
  purgeFailed.sort();
  return { expireReady, purgeFailed };
}

export type RequestCheck = {
  actingRole: string;
  stepUp: StepUp | null;
  now: Date;
  myRecent: Date[];
  tenantInFlight: number;
  tenantState: string;
};

export function checkRequest(c: RequestCheck): void {
  if (c.actingRole !== "owner") throw new ExportRuleError("ERR_FORBIDDEN", "owner_only");
  if (c.stepUp?.verified !== true) throw new ExportRuleError("ERR_FORBIDDEN", "step_up_required");
  if (!(EXPORTABLE_STATES as readonly string[]).includes(c.tenantState)) {
    throw new ExportRuleError("ERR_VERSION_CONFLICT", `tenant_${c.tenantState}`);
  }
  const since = c.now.getTime() - RATE.windowMs;
  if (c.myRecent.filter((t) => t.getTime() > since).length >= RATE.requests) {
    throw new ExportRuleError("ERR_RATE_LIMITED", "exports");
  }
  if (c.tenantInFlight > 0) throw new ExportRuleError("ERR_VERSION_CONFLICT", "export_in_progress");
}

// Store-only ZIP (zero dependency; CRC-32 from node:zlib). Pilot ceiling MAX_ENTRIES=10_000 & MAX_TOTAL_BYTES=256 MiB << ZIP32 limit.
const U32 = 0xffffffff;
export function zipStore(files: readonly { path: string; bytes: Uint8Array }[], at: Date): Uint8Array {
  if (files.length > 0xffff) throw new ExportRuleError("ERR_INVALID_INPUT", "too_many_files");
  const dosTime = ((at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2)) & 0xffff;
  const dosDate = (((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate()) & 0xffff;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, "utf8");
    const data = Buffer.from(f.bytes);
    if (data.byteLength >= U32 || offset >= U32) throw new ExportRuleError("ERR_INVALID_INPUT", "too_large");
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.byteLength + name.byteLength + data.byteLength;
  }
  const cd = Buffer.concat(centrals);
  if (offset >= U32 || cd.byteLength >= U32) throw new ExportRuleError("ERR_INVALID_INPUT", "too_large");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

export function exportZip(m: Manifest, files: readonly ExportFile[], at: Date): Uint8Array {
  assertPilotCeilings(files);
  const bad = verifyManifest(m, files);
  if (bad.length) throw new ExportRuleError("ERR_VERSION_CONFLICT", `manifest:${bad[0]}`);
  const byPath = new Map(files.map((f) => [f.path, f]));
  return zipStore(
    [
      { path: MANIFEST_PATH, bytes: manifestBytes(m) },
      ...m.files.map((e) => ({ path: e.path, bytes: byPath.get(e.path)!.bytes })),
    ],
    at,
  );
}

export function unzipStore(zip: Uint8Array): Map<string, Uint8Array> {
  const b = Buffer.from(zip);
  const out = new Map<string, Uint8Array>();
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new ExportRuleError("ERR_INVALID_INPUT", "not_a_zip");
  let p = b.readUInt32LE(eocd + 16);
  for (let i = 0; i < b.readUInt16LE(eocd + 10); i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new ExportRuleError("ERR_INVALID_INPUT", "central");
    const crc = b.readUInt32LE(p + 16);
    const size = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28);
    const xlen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    const lo = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const start = lo + 30 + b.readUInt16LE(lo + 26) + b.readUInt16LE(lo + 28);
    const data = b.subarray(start, start + size);
    if ((crc32(data) >>> 0) !== crc) throw new ExportRuleError("ERR_INVALID_INPUT", `crc ${name}`);
    out.set(name, new Uint8Array(data));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

// Canonical relative POSIX archive layout (opaque patient index; never patient name or MRN in paths).
export const fhirPath = (n: number): string => `fhir/pasien-${String(n).padStart(5, "0")}.json`;
export const pdfPath = (n: number, version: number, recordId: string): string =>
  `rekam-medis/pasien-${String(n).padStart(5, "0")}/rekam-${recordId}-v${version}.pdf`;
export const mediaPath = (n: number, mediaId: string, ext: string): string =>
  `media/pasien-${String(n).padStart(5, "0")}/media-${mediaId}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin"}`;
export const csvPath = (family: string): string => `csv/${family}.csv`;

export const CSV_FAMILIES = [
  "pasien",
  "kunjungan",
  "tagihan",
  "baris_tagihan",
  "pembayaran",
  "paket",
  "saldo",
  "piutang",
  "jurnal",
  "baris_jurnal",
  "lead",
  "percakapan",
  "pesan_wa",
] as const;
export type CsvFamily = (typeof CSV_FAMILIES)[number];
