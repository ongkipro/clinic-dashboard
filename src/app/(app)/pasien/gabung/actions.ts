"use server";
// Gabung Data Ganda actions (PR-85, T-042; HYG-NAV-2): search (POST body only), merge with a reason, undo a merge with a reason. Each
// refuses a form rendered in another context first (HYG-009 B2-1); patient_merge / patient_unmerge decide authority (records officer)
// and validity; every write carries the form's per-mount idempotency key.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { mergePatients, unmergePatients } from "../../../../modules/patients/merge/merge";
import { type Row, searchPatients } from "../../../../modules/patients/search/search";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";
import { checkMerge, checkReason, pairToMerge } from "./model";

export type FindState = { error?: string; rows?: Row[]; q?: string; n?: number };
export type MergeState = { error?: string; ok?: string; n?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya Perekam Medis yang dapat menggabungkan data pasien.",
  ERR_NOT_FOUND: "Pasien atau penggabungan tidak ditemukan. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali pilihan pasien dan alasan.",
  ERR_VERSION_CONFLICT: "Data sudah berubah (pasien sudah digabung atau penggabungan sudah dibatalkan). Muat ulang halaman.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengoreksi rekam data.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_RATE_LIMITED: "Terlalu banyak pencarian. Coba lagi sebentar.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("gabung: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
async function ctxOr(f: FormData) {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  return { ctx: rc.active.context };
}

// Never logs or echoes the query into a URL.
export async function findAction(prev: FindState, f: FormData): Promise<FindState> {
  const n = (prev.n ?? 0) + 1;
  const c = await ctxOr(f);
  if ("error" in c) return { error: c.error, n };
  const q = str(f, "q");
  if (q.length < 2) return { error: "Ketik minimal 2 huruf nama, No. RM atau nomor HP.", q, n };
  try {
    const page = await withTenantContext(await appPool(), c.ctx, (db) => searchPatients(db, q));
    return page.ok ? { rows: page.rows, q, n } : { error: COPY.ERR_RATE_LIMITED, q, n };
  } catch (e) {
    return { error: message(e), q, n };
  }
}

export async function mergeAction(prev: MergeState, f: FormData): Promise<MergeState> {
  const n = (prev.n ?? 0) + 1;
  const c = await ctxOr(f);
  if ("error" in c) return { error: c.error, n };
  const input = pairToMerge(str(f, "pair_a"), str(f, "pair_b"), str(f, "survivor"), str(f, "reason"));
  if (!input) return { error: "Pilih data yang dipertahankan.", n };
  const chk = checkMerge(input);
  if (!chk.ok) return { error: chk.error, n };
  const key = str(f, "key");
  if (!UUID.test(key)) return { error: COPY.ERR_VERSION_CONFLICT, n };
  try {
    await withTenantContext(await appPool(), c.ctx, (db) => mergePatients(db, key, input.survivor, input.merged, input.reason));
  } catch (e) {
    return { error: message(e), n };
  }
  // The merge form unmounts once the side is merged, so an in-form notice could never show: redirect (outside the catch, after commit)
  // to the pair with a fixed notice code the page maps (as /kampanye, /pesan).
  revalidatePath("/pasien/gabung");
  redirect(`/pasien/gabung?${new URLSearchParams({ a: input.survivor, b: input.merged, ok: "merged" })}`);
}

export async function unmergeAction(prev: MergeState, f: FormData): Promise<MergeState> {
  const n = (prev.n ?? 0) + 1;
  const c = await ctxOr(f);
  if ("error" in c) return { error: c.error, n };
  const id = str(f, "merge");
  const reason = str(f, "reason");
  const chk = checkReason(reason);
  if (!UUID.test(id)) return { error: COPY.ERR_NOT_FOUND, n };
  if (!chk.ok) return { error: chk.error, n };
  const key = str(f, "key");
  if (!UUID.test(key)) return { error: COPY.ERR_VERSION_CONFLICT, n };
  try {
    await withTenantContext(await appPool(), c.ctx, (db) => unmergePatients(db, key, id, reason));
  } catch (e) {
    return { error: message(e), n };
  }
  revalidatePath("/pasien/gabung");
  const back = Object.fromEntries((["a", "b"] as const).map((k) => [k, str(f, k)] as const).filter(([, v]) => UUID.test(v)));
  redirect(`/pasien/gabung?${new URLSearchParams({ ...back, ok: "unmerged" })}`);
}
