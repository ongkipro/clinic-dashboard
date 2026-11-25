// T-122 (PR-52, UX-32, TEN-18, RATE-5, SEC-5; R3) — Pure unit tests covering canonical manifest
// binding (tenantId, exportId, generation), 1-to-1 integrity checks (missing/extra/duplicate/kind/tamper),
// 24h expiry, decoupled ready/failed purge plan, pilot ceilings, HYG-026 StepUp request check,
// store-only ZIP round-trip, and UX-32 / Backup view models.
import { describe, expect, it } from "vitest";
import { projectEkspor, remaining, size } from "../../src/app/(app)/ekspor/model";
import { projectBackup } from "../../src/app/(app)/ekspor/backup/model";
import {
  assertPilotCeilings,
  buildManifest,
  canDownload,
  checkRequest,
  EXPIRY_MS,
  exportZip,
  manifestJsonString,
  MAX_ENTRIES,
  MAX_FILE_BYTES,
  mediaPath,
  parseVerifiedManifest,
  pdfPath,
  purgePlan,
  safePath,
  sha256,
  unzipStore,
  verifyManifest,
  type ExportFile,
} from "../../src/modules/export/export";
import { stepUpForTests } from "../support/step-up";

const enc = (s: string) => new TextEncoder().encode(s);

describe("T-122 tenant export pure rules", () => {
  const T = "01950000-0000-7000-8000-000000000001";
  const E = "01950000-0000-7000-8000-000000000002";
  const T0 = new Date("2026-11-24T00:00:00.000Z");

  it("validates canonical relative POSIX paths and rejects traversal / manifest.json", () => {
    expect(safePath("fhir/pasien-00001.json")).toBe(true);
    expect(safePath("csv/pasien.csv")).toBe(true);
    expect(safePath("manifest.json")).toBe(false);
    expect(safePath("../etc/passwd")).toBe(false);
    expect(safePath("/abs/path.csv")).toBe(false);
    expect(safePath("a/./b.csv")).toBe(false);
    expect(safePath("a/../b.csv")).toBe(false);

    // R3 P0-1: full UUIDv7 IDs prevent burst collisions within the same 65.5 s prefix window.
    const id1 = "019ab123-0000-7000-8000-000000000001";
    const id2 = "019ab123-0000-7000-8000-000000000002";
    const m1 = mediaPath(1, id1, "png");
    const m2 = mediaPath(1, id2, "png");
    expect(m1).not.toBe(m2);
    expect(m1).toContain(id1);
    expect(safePath(m1)).toBe(true);
    const p1 = pdfPath(1, 1, id1);
    const p2 = pdfPath(1, 1, id2);
    expect(p1).not.toBe(p2);
    expect(p1).toContain(id1);
    expect(safePath(p1)).toBe(true);
  });

  it("builds deterministic canonical manifest bound to (tenantId, exportId, generation) and detects every tamper vector (Finding #6)", () => {
    const files: ExportFile[] = [
      { path: "csv/pasien.csv", kind: "csv", bytes: enc("id,mrn\r\n1,RM-000001\r\n") },
      { path: "fhir/pasien-00001.json", kind: "fhir", bytes: enc('{"resourceType":"Bundle"}\n') },
    ];
    const m = buildManifest({ tenantId: T, exportId: E, generation: 2, completedAt: T0, files });
    const raw = manifestJsonString(m);
    const digest = sha256(raw);

    // Valid parse & verification
    const parsed = parseVerifiedManifest(raw, digest, { tenantId: T, exportId: E, generation: 2 });
    expect(parsed.files.map((f) => f.path)).toEqual(["csv/pasien.csv", "fhir/pasien-00001.json"]);
    expect(verifyManifest(parsed, files)).toEqual([]);

    // Tamper vectors refused
    expect(() => parseVerifiedManifest(raw, "0".repeat(64), { tenantId: T, exportId: E, generation: 2 })).toThrow("manifest_hash_mismatch");
    expect(() => parseVerifiedManifest(raw, digest, { tenantId: "01950000-0000-7000-8000-000000000099", exportId: E, generation: 2 })).toThrow("manifest_identity_mismatch");
    expect(() => parseVerifiedManifest(raw, digest, { tenantId: T, exportId: E, generation: 1 })).toThrow("manifest_identity_mismatch");

    // Missing row, extra row, duplicate path, kind mismatch, byte tamper
    expect(verifyManifest(parsed, [files[0]])).toContain("missing fhir/pasien-00001.json");
    expect(verifyManifest(parsed, [...files, { path: "csv/extra.csv", kind: "csv", bytes: enc("x") }])).toContain("unlisted csv/extra.csv");
    expect(verifyManifest(parsed, [...files, files[0]])).toContain("duplicate csv/pasien.csv");
    expect(verifyManifest(parsed, [{ ...files[0], kind: "pdf" }, files[1]])).toContain("kind_mismatch csv/pasien.csv");
    expect(verifyManifest(parsed, [{ ...files[0], bytes: enc("tampered") }, files[1]])).toContain("changed csv/pasien.csv");

    // Store-only ZIP round-trip with CRC-32 verification
    const zip = exportZip(parsed, files, T0);
    const out = unzipStore(zip);
    expect([...out.keys()]).toEqual(["manifest.json", "csv/pasien.csv", "fhir/pasien-00001.json"]);
    expect(new TextDecoder().decode(out.get("manifest.json")!)).toBe(raw);
    expect(new TextDecoder().decode(out.get("csv/pasien.csv")!)).toBe("id,mrn\r\n1,RM-000001\r\n");
  });

  it("enforces 24h expiry, closed-tenant refusal, and decoupled ready/failed purge plan (Findings #3 & #5)", () => {
    expect(canDownload({ state: "ready", completedAt: T0, tenantState: "live" }, new Date(T0.getTime() + EXPIRY_MS - 1)).ok).toBe(true);
    expect(canDownload({ state: "ready", completedAt: T0, tenantState: "suspended" }, new Date(T0.getTime() + 1000)).ok).toBe(true);
    expect(canDownload({ state: "ready", completedAt: T0, tenantState: "exit" }, new Date(T0.getTime() + 1000)).ok).toBe(true);
    expect(canDownload({ state: "ready", completedAt: T0, tenantState: "closed" }, new Date(T0.getTime() + 1000))).toMatchObject({ ok: false, reason: "tenant_closed" });
    expect(canDownload({ state: "ready", completedAt: T0 }, new Date(T0.getTime() + EXPIRY_MS))).toMatchObject({ ok: false, code: "ERR_EXPIRED" });

    const plan = purgePlan(
      [
        { id: "r1", state: "ready", completedAt: T0, requestedAt: T0, purgedAt: null },
        { id: "r2", state: "ready", completedAt: new Date(T0.getTime() + 60_000), requestedAt: T0, purgedAt: null },
        { id: "f1", state: "failed", completedAt: null, requestedAt: T0, purgedAt: null },
        { id: "f2", state: "failed", completedAt: null, requestedAt: T0, purgedAt: new Date(T0.getTime() + EXPIRY_MS) },
      ],
      new Date(T0.getTime() + EXPIRY_MS),
    );
    expect(plan).toEqual({ expireReady: ["r1"], purgeFailed: ["f1"] });
  });

  it("enforces owner-only, HYG-026 StepUp, RATE-5, single in-flight, and pilot ceilings (Findings #4 & #7)", () => {
    const proof = stepUpForTests();
    expect(() => checkRequest({ actingRole: "admin_pusat", stepUp: proof, now: T0, myRecent: [], tenantInFlight: 0, tenantState: "live" })).toThrow("owner_only");
    expect(() => checkRequest({ actingRole: "owner", stepUp: null, now: T0, myRecent: [], tenantInFlight: 0, tenantState: "live" })).toThrow("step_up_required");
    expect(() => checkRequest({ actingRole: "owner", stepUp: proof, now: T0, myRecent: [], tenantInFlight: 0, tenantState: "closed" })).toThrow("tenant_closed");
    expect(() => checkRequest({ actingRole: "owner", stepUp: proof, now: T0, myRecent: [T0, T0, T0, T0, T0], tenantInFlight: 0, tenantState: "live" })).toThrow("exports");
    expect(() => checkRequest({ actingRole: "owner", stepUp: proof, now: T0, myRecent: [], tenantInFlight: 1, tenantState: "live" })).toThrow("export_in_progress");
    expect(() => checkRequest({ actingRole: "owner", stepUp: proof, now: T0, myRecent: [], tenantInFlight: 0, tenantState: "exit" })).not.toThrow();

    expect(() => assertPilotCeilings([{ path: "media/big.bin", bytes: new Uint8Array(MAX_FILE_BYTES + 1) }])).toThrow("export_file_too_large");
    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ path: `csv/f${i}.csv`, bytes: new Uint8Array(1) }));
    expect(() => assertPilotCeilings(many)).toThrow("export_too_many_entries");
  });

  it("projects UX-32 Ekspor and Backup models honestly (owner-only, not_measured backup)", () => {
    expect(projectEkspor({ actingRole: "admin_pusat", reader: { jobs: [] }, now: T0 }).kind).toBe("blocked");
    const ok = projectEkspor({
      actingRole: "owner",
      reader: {
        jobs: [
          {
            id: E,
            state: "ready",
            requested_at: T0.toISOString(),
            completed_at: T0.toISOString(),
            expires_at: new Date(T0.getTime() + EXPIRY_MS).toISOString(),
            size_bytes: 2048,
            file_count: 14,
            manifest_sha256: "a".repeat(64),
            download_count: 0,
            error_code: null,
          },
        ],
      },
      now: new Date(T0.getTime() + 3_600_000),
    });
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") {
      expect(ok.jobs[0].canDownload).toBe(true);
      expect(remaining(ok.jobs[0].expiresAt, ok.now)).toBe("23 jam lagi");
      expect(size(ok.jobs[0].sizeBytes)).toBe("2 KB");
    }

    const bk = projectBackup({ actingRole: "owner", source: null, now: T0 });
    expect(bk.kind).toBe("ok");
    if (bk.kind === "ok") {
      expect(bk.backup.kind).toBe("not_measured");
      expect(bk.drill.kind).toBe("not_measured");
    }
    expect(projectBackup({ actingRole: "finance", source: null, now: T0 }).kind).toBe("blocked");
  });
});
