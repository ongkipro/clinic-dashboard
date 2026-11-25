"use server";
// UX-1 / UX-41 ▸ Impor Data Awal server actions (PR-85, DATA-58, ARCH-10; T-128).
// Owner-only actions with ContextFields stale-context check (HYG-009 B2-1); zero raw PII in error responses.
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import {
  approveImportBatch,
  dryRunValidateImport,
  formatDryRunReconciliationCsv,
  IMPORT_ROLLBACK_REASONS,
  rollbackImportBatch,
  type ImportBatchInput,
  type ImportRollbackReason,
  type ReconciliationSummary,
  type RowIssue,
} from "../../../../modules/import";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export type ImportDryRunState = {
  error?: string;
  summary?: ReconciliationSummary;
  reconciliationCsv?: string;
  issues?: RowIssue[];
  n?: number;
};

export type ApproveBatchState = {
  error?: string;
  ok?: string;
  n?: number;
};

export type RollbackBatchState = {
  error?: string;
  ok?: string;
  n?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");

function deriveTenantHmacKey(tenantId: string): Buffer {
  const secret = process.env.IMPORT_HMAC_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("ERR_MISSING_SECRET: IMPORT_HMAC_SECRET or BETTER_AUTH_SECRET is required");
  }
  return createHash("sha256").update(`import-hmac-v1|${secret}|${tenantId}`, "utf8").digest();
}

export async function dryRunImportAction(prev: ImportDryRunState, f: FormData): Promise<ImportDryRunState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked" || rc.active.context.actingRole !== "owner") {
    return { error: "Hanya Owner klinik yang dapat menjalankan uji coba impor data awal.", n: (prev.n ?? 0) + 1 };
  }
  if (staleContext(f, rc.active.context)) {
    return { error: STALE_CONTEXT, n: (prev.n ?? 0) + 1 };
  }

  const rawJson = str(f, "payload_json");
  if (!rawJson || rawJson.length > 5_000_000) {
    return { error: "Tempelkan berkas JSON data awal yang valid (maksimal 5 MB).", n: (prev.n ?? 0) + 1 };
  }

  let parsed: Partial<ImportBatchInput>;
  try {
    parsed = JSON.parse(rawJson) as Partial<ImportBatchInput>;
  } catch {
    return { error: "Format JSON tidak valid. Periksa sintaks berkas sebelum uji coba.", n: (prev.n ?? 0) + 1 };
  }

  const c = rc.active.context;
  const { branchCodes, catalogCodes } = await withTenantContext(await appPool(), c, async (db) => {
    const bRes = await db.query<{ code: string }>(`SELECT code FROM public.branches ORDER BY code`);
    const cRes = await db.query<{ code: string }>(`SELECT code FROM public.catalog_items WHERE kind = 'service' ORDER BY code`);
    return {
      branchCodes: new Set(bRes.rows.map((r) => r.code.trim().toUpperCase())),
      catalogCodes: new Set(cRes.rows.map((r) => r.code.trim().toUpperCase())),
    };
  });

  const result = dryRunValidateImport({
    tenantHmacKey: deriveTenantHmacKey(c.tenantId),
    sourceSystem: typeof parsed.sourceSystem === "string" && parsed.sourceSystem.trim() ? parsed.sourceSystem.trim() : "legacy_clinic_system",
    cutoverDate: typeof parsed.cutoverDate === "string" ? parsed.cutoverDate.trim() : "",
    knownBranchCodes: branchCodes,
    knownServiceCodes: catalogCodes,
    patients: Array.isArray(parsed.patients) ? parsed.patients : [],
    packages: Array.isArray(parsed.packages) ? parsed.packages : [],
    balances: Array.isArray(parsed.balances) ? parsed.balances : [],
    receivables: Array.isArray(parsed.receivables) ? parsed.receivables : [],
    bookingDps: Array.isArray(parsed.bookingDps) ? parsed.bookingDps : [],
  });

  if (!result.ok) {
    return { issues: result.issues, error: `Ditemukan ${result.issues.length} kesalahan validasi pada data awal.`, n: (prev.n ?? 0) + 1 };
  }

  return {
    summary: result.summary,
    reconciliationCsv: formatDryRunReconciliationCsv(result.summary),
    n: (prev.n ?? 0) + 1,
  };
}

export async function approveImportBatchAction(prev: ApproveBatchState, f: FormData): Promise<ApproveBatchState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked" || rc.active.context.actingRole !== "owner") {
    return { error: "Hanya Owner klinik yang dapat menyetujui batch impor.", n: (prev.n ?? 0) + 1 };
  }
  if (staleContext(f, rc.active.context)) {
    return { error: STALE_CONTEXT, n: (prev.n ?? 0) + 1 };
  }

  const batchId = str(f, "batch_id");
  const revision = Number.parseInt(str(f, "validation_revision"), 10);
  const manifestSha = str(f, "manifest_sha256");

  if (!UUID.test(batchId) || !Number.isSafeInteger(revision) || revision < 1 || !SHA256.test(manifestSha)) {
    return { error: "Parameter persetujuan batch tidak valid. Muat ulang halaman.", n: (prev.n ?? 0) + 1 };
  }

  try {
    await withTenantContext(await appPool(), rc.active.context, (db) =>
      approveImportBatch(db, batchId, revision, manifestSha),
    );
    revalidatePath("/pasien/impor");
    return { ok: "Batch impor disetujui oleh Owner dan siap diterapkan.", n: (prev.n ?? 0) + 1 };
  } catch (e) {
    if (e instanceof CommandError) {
      return { error: "Batch tidak dapat disetujui pada status saat ini. Muat ulang halaman.", n: (prev.n ?? 0) + 1 };
    }
    return { error: "Persetujuan belum pasti tersimpan. Muat ulang halaman untuk memeriksa status.", n: (prev.n ?? 0) + 1 };
  }
}

export async function rollbackImportBatchAction(prev: RollbackBatchState, f: FormData): Promise<RollbackBatchState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked" || rc.active.context.actingRole !== "owner") {
    return { error: "Hanya Owner klinik yang dapat membatalkan batch impor.", n: (prev.n ?? 0) + 1 };
  }
  if (staleContext(f, rc.active.context)) {
    return { error: STALE_CONTEXT, n: (prev.n ?? 0) + 1 };
  }

  const batchId = str(f, "batch_id");
  const reason = str(f, "rollback_reason");
  if (!UUID.test(batchId) || !(IMPORT_ROLLBACK_REASONS as readonly string[]).includes(reason)) {
    return { error: "Pilih alasan pembatalan yang valid dan coba lagi.", n: (prev.n ?? 0) + 1 };
  }

  try {
    await withTenantContext(await appPool(), rc.active.context, (db) =>
      rollbackImportBatch(db, batchId, reason as ImportRollbackReason),
    );
    revalidatePath("/pasien/impor");
    return { ok: "Batch impor dibatalkan secara append-only dan jurnal pembalik diterbitkan.", n: (prev.n ?? 0) + 1 };
  } catch (e) {
    if (e instanceof CommandError) {
      return { error: "Batch tidak dapat dibatalkan (periode terkunci, jurnal sudah diekspor, atau status berubah).", n: (prev.n ?? 0) + 1 };
    }
    return { error: "Pembatalan belum pasti tersimpan. Muat ulang halaman untuk memeriksa status.", n: (prev.n ?? 0) + 1 };
  }
}
