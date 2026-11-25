// UX-1 / UX-41 ▸ Impor Data Awal loader (PR-85, DATA-58, ARCH-10; T-128).
// Owner-only workspace: checks real-patient gate blockers (DPA/residency) and lists sanitized batch summaries.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { listImportBatches, type BatchSummaryDto } from "../../../../modules/import";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { OBLIGATION_LABEL, realPatientGateStatus, type Obligation } from "../../../../modules/platform/residency";

const BLOCKER_COPY: Record<string, string> = {
  residency_opinion_missing: "Opini hukum residensi data belum dicatat oleh pemilik platform.",
  residency_opinion_negative: "Opini hukum residensi data bernilai negatif; lokasi server Indonesia diperlukan.",
  residency_opinion_inconclusive: "Opini hukum residensi data belum konklusif.",
  residency_attestation_missing: "Atestasi lokasi server produksi belum tercatat.",
  residency_attestation_mismatch: "Lokasi server terpasang tidak cocok dengan deklarasi residensi.",
  residency_attestation_stale: "Atestasi lokasi server tidak cocok dengan rilis aktif.",
  vendor_profile_placeholder: "Profil badan hukum vendor masih mengandung placeholder.",
};

function labelForGateBlocker(code: string): string {
  if (code in BLOCKER_COPY) return BLOCKER_COPY[code];
  if (code in OBLIGATION_LABEL) return `Bukti kepatuhan belum disetujui: ${OBLIGATION_LABEL[code as Obligation]}`;
  return `Prasyarat kepatuhan belum terpenuhi (${code}).`;
}

export type ImportWorkspaceData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | {
      kind: "ok";
      ctx: RenderedContext;
      gateBlockers: { code: string; label: string }[];
      batches: BatchSummaryDto[];
    };

export async function loadImportWorkspace(): Promise<ImportWorkspaceData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || rc.active.context.actingRole !== "owner") {
    return { kind: "forbidden" };
  }
  const c = rc.active.context;
  try {
    const { blockers, batches } = await withTenantContext(await appPool(), c, async (db) => {
      const blockers = await realPatientGateStatus(db);
      const batches = await listImportBatches(db);
      return { blockers, batches };
    });
    return {
      kind: "ok",
      ctx: renderedContext(c),
      gateBlockers: blockers.map((code) => ({ code, label: labelForGateBlocker(code) })),
      batches,
    };
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_FORBIDDEN" || e.code === "ERR_TENANT_SUSPENDED")) {
      return { kind: "forbidden" };
    }
    throw e;
  }
}
