"use server";
// UX-32 Ekspor Data server action (PR-52; T-122).
// Enforces rendered context (HYG-009 B2-1) and real HYG-026 TOTP step-up (Finding #4).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "../../../auth/instance";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { requestTenantExport } from "../../../modules/export/tenant.export";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

export type ExportActionState = { error?: string; ok?: string; exportId?: string; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COPY: Record<string, string> = {
  owner_only: "Ekspor penuh hanya untuk Owner.",
  step_up_required: "Masukkan kode autentikator 6 digit (TOTP) yang masih berlaku untuk verifikasi ulang.",
  second_factor_required: "Aktifkan autentikasi dua faktor (2FA) terlebih dahulu sebelum meminta ekspor.",
  export_in_progress: "Ekspor lain masih dalam antrean atau sedang dibuat. Tunggu sampai selesai.",
  exports: "Terlalu banyak permintaan ekspor dalam 5 menit terakhir. Coba lagi beberapa menit lagi.",
  tenant_closed: "Klinik berstatus ditutup tidak dapat meminta ekspor baru.",
  tenant_provisioning: "Klinik belum aktif sehingga belum dapat diekspor.",
  tenant_onboarding: "Klinik masih dalam proses onboarding sehingga belum dapat diekspor.",
  ERR_FORBIDDEN: "Ekspor penuh hanya untuk Owner dengan verifikasi TOTP aktif.",
  ERR_RATE_LIMITED: "Batas permintaan ekspor tercapai (maksimal 5 kali per 5 menit). Coba lagi nanti.",
  ERR_VERSION_CONFLICT: "Permintaan ekspor tidak dapat diproses pada status saat ini.",
};

const done = (prev: ExportActionState, s: ExportActionState): ExportActionState => ({ ...s, n: (prev.n ?? 0) + 1 });

export async function requestExportAction(prev: ExportActionState, f: FormData): Promise<ExportActionState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return done(prev, { error: COPY.owner_only });
  if (staleContext(f, rc.active.context)) return done(prev, { error: STALE_CONTEXT });

  const key = typeof f.get("key") === "string" ? (f.get("key") as string).trim() : "";
  if (!UUID.test(key)) return done(prev, { error: COPY.ERR_VERSION_CONFLICT });

  const code = typeof f.get("totp_code") === "string" ? (f.get("totp_code") as string).trim() : "";
  const h = await headers();
  const auth = await getAuth();
  const proof = code ? await auth.stepUp(h, code) : await auth.freshStepUp(h);
  if (!proof) return done(prev, { error: COPY.step_up_required });

  try {
    const res = await withTenantContext(await appPool(), rc.active.context, (db) => requestTenantExport(db, key, proof));
    revalidatePath("/ekspor");
    return done(prev, {
      ok: res.replayed ? "Permintaan ekspor sudah tercatat dalam antrean." : "Permintaan ekspor masuk antrean. Berkas siap diunduh selama 24 jam setelah selesai.",
      exportId: res.id,
    });
  } catch (e) {
    if (e instanceof CommandError) {
      const reason = (e as { reason?: string }).reason ?? "";
      return done(prev, { error: COPY[reason] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN });
    }
    console.error("ekspor: request failed", { error: e instanceof Error ? e.name : "unknown" });
    return done(prev, { error: "Permintaan ekspor gagal disimpan. Muat ulang halaman untuk memeriksa status." });
  }
}
