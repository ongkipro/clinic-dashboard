"use server";
// Daftar Pasien actions (PR-76, T-041): search (POST: the query is in the body only, never in a URL or a
// log line), save and delete a segment. Each refuses a form rendered in another context first (HYG-009
// B2-1). A rate-limited search commits its count and alert, then answers with the 429 copy.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { deleteSegment, type Filters, type Row, saveSegment, searchPatients } from "../../../../modules/patients/search/search";

export type SearchState = { error?: string; rows?: Row[]; more?: boolean; filters?: Filters; q?: string; n?: number; searched?: boolean };
export type SegmentState = { error?: string; ok?: string; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat mencari pasien.",
  ERR_NOT_FOUND: "Segmen tidak ditemukan. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kata pencarian atau filter.",
  ERR_RATE_LIMITED: "Terlalu banyak pencarian. Coba lagi sebentar.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengubah ini.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  segment: "Beri nama segmen (2–60 huruf) dan pilih minimal satu filter.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
// Never logs the query: only the error's name.
const message = (e: unknown) => {
  if (e instanceof CommandError) return COPY[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("daftar-pasien: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Pencarian belum berhasil. Coba lagi.";
};
function filtersOf(f: FormData): Filters {
  const out: Filters = {};
  if (UUID.test(str(f, "branch_id"))) out.branch_id = str(f, "branch_id");
  const last = str(f, "last_visit");
  if (last === "30d" || last === "90d" || last === "never") out.last_visit = last;
  if (f.get("visiting_now") === "on") out.visiting_now = true;
  return out;
}
async function ctxOr<S extends { n?: number; error?: string }>(prev: S, f: FormData) {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { stop: { ...prev, error: COPY.ERR_FORBIDDEN, n: (prev.n ?? 0) + 1 } as S };
  if (staleContext(f, rc.active.context)) return { stop: { ...prev, error: STALE_CONTEXT, n: (prev.n ?? 0) + 1 } as S };
  return { ctx: rc.active.context };
}

export async function searchAction(prev: SearchState, f: FormData): Promise<SearchState> {
  const c = await ctxOr(prev, f);
  if ("stop" in c) return c.stop!;
  const q = str(f, "q");
  const filters = filtersOf(f);
  const after = UUID.test(str(f, "after")) ? str(f, "after") : null;
  const n = (prev.n ?? 0) + 1;
  if (q.length === 1) return { error: "Ketik minimal 2 huruf, atau kosongkan untuk memakai filter saja.", q, filters, n };
  if (!q && Object.keys(filters).length === 0) return { error: "Ketik nama, No. RM atau nomor HP, atau pilih filter.", q, filters, n };
  try {
    const page = await withTenantContext(await appPool(), c.ctx, (db) => searchPatients(db, q, filters, after));
    if (!page.ok) return { error: COPY.ERR_RATE_LIMITED, q, filters, n };
    // "Muat lagi" appends to the rows already shown.
    return { rows: after ? [...(prev.rows ?? []), ...page.rows] : page.rows, more: page.more, q, filters, n, searched: true };
  } catch (e) {
    return { error: message(e), q, filters, n };
  }
}

export async function saveSegmentAction(prev: SegmentState, f: FormData): Promise<SegmentState> {
  const c = await ctxOr(prev, f);
  if ("stop" in c) return c.stop!;
  const key = str(f, "key");
  const name = str(f, "name");
  const filters = filtersOf(f);
  const n = (prev.n ?? 0) + 1;
  if (!UUID.test(key)) return { error: COPY.ERR_INVALID_INPUT, n };
  if (name.length < 2 || name.length > 60 || Object.keys(filters).length === 0) return { error: COPY.segment, n };
  try {
    await withTenantContext(await appPool(), c.ctx, (db) => saveSegment(db, key, name, filters));
  } catch (e) {
    return { error: e instanceof CommandError && e.code === "ERR_INVALID_INPUT" ? COPY.segment : message(e), n };
  }
  revalidatePath("/pasien");
  return { ok: "Segmen disimpan.", n };
}

export async function deleteSegmentAction(prev: SegmentState, f: FormData): Promise<SegmentState> {
  const c = await ctxOr(prev, f);
  if ("stop" in c) return c.stop!;
  const key = str(f, "key");
  const id = str(f, "id");
  const n = (prev.n ?? 0) + 1;
  if (!UUID.test(key) || !UUID.test(id)) return { error: COPY.ERR_NOT_FOUND, n };
  try {
    await withTenantContext(await appPool(), c.ctx, (db) => deleteSegment(db, key, id));
  } catch (e) {
    return { error: message(e), n };
  }
  revalidatePath("/pasien");
  return { ok: "Segmen dihapus.", n };
}
