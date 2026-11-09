"use server";
// Antrean actions (UX-6 ▸ Antrean, PR-71, T-048): search a patient (POST only, minimal projection),
// Daftarkan Kunjungan (walk-in), Panggil, Lewati, Pasangkan Layar TV, Cabut. Each refuses a form rendered in
// another context first (HYG-009 B2-1); the database decides authority and the active branch. Every write
// carries the form's per-mount idempotency key. The search query is never logged.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { callTicket, type Found, pairDisplay, revokeDisplay, searchPatients, skipTicket, walkIn } from "../../../modules/visits/queue/queue";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type QueueState = { error?: string; ok?: string; n?: number; number?: string; link?: string };
export type FindState = { error?: string; matches?: Found[]; q?: string; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat melakukan ini di Antrean.",
  ERR_NOT_FOUND: "Pasien, nomor, ruang atau layar tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak melayani kunjungan.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  already_open: "Pasien ini masih punya kunjungan terbuka di cabang ini.",
  already_skipped: "Nomor ini sudah dilewati.",
  ticket_done: "Kunjungan nomor ini sudah selesai.",
  already_revoked: "Layar ini sudah dicabut.",
  query: "Ketik minimal 2 huruf nama, No. RM atau nomor HP.",
  label: "Beri nama layar (2–60 huruf).",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const done = <S extends { n?: number }>(prev: S, s: S): S => ({ ...s, n: (prev.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return COPY[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("antrean: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
async function ctxOr<S extends { n?: number; error?: string }>(prev: S, f: FormData) {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { stop: done(prev, { error: COPY.ERR_FORBIDDEN } as S) };
  if (staleContext(f, rc.active.context)) return { stop: done(prev, { error: STALE_CONTEXT } as S) };
  return { ctx: rc.active.context };
}
// The branch posted by Owner/Admin Pusat on "Semua Cabang"; the database refuses it for the others.
const branchOf = (f: FormData) => (UUID.test(str(f, "branch")) ? str(f, "branch") : null);

async function write(prev: QueueState, f: FormData, work: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0], key: string) => Promise<Partial<QueueState> | void>, ok: string) {
  const c = await ctxOr(prev, f);
  if ("stop" in c) return c.stop!;
  const key = str(f, "key");
  if (!UUID.test(key)) return done(prev, { error: COPY.ERR_VERSION_CONFLICT });
  let extra: Partial<QueueState> | void;
  try {
    extra = await withTenantContext(await appPool(), c.ctx, (db) => work(db, key));
  } catch (e) {
    return done(prev, { error: message(e) });
  }
  revalidatePath("/antrean");
  return done(prev, { ok, ...(extra ?? {}) });
}

export async function findPatientAction(prev: FindState, f: FormData): Promise<FindState> {
  const c = await ctxOr(prev, f);
  if ("stop" in c) return c.stop!;
  const q = str(f, "q");
  if (q.length < 2) return done(prev, { error: COPY.query, q });
  try {
    return done(prev, { matches: await withTenantContext(await appPool(), c.ctx, (db) => searchPatients(db, q)), q });
  } catch (e) {
    return done(prev, { error: message(e), q });
  }
}
export async function walkInAction(prev: QueueState, f: FormData): Promise<QueueState> {
  const patient = str(f, "patient");
  if (!UUID.test(patient)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return write(prev, f, async (db, key) => ({ number: (await walkIn(db, key, patient, branchOf(f))).number }), "Kunjungan dibuka.");
}
export async function callAction(prev: QueueState, f: FormData): Promise<QueueState> {
  const ticket = str(f, "ticket");
  const room = str(f, "room");
  if (!UUID.test(ticket) || !UUID.test(room)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return write(prev, f, async (db, key) => { await callTicket(db, key, ticket, room); }, "Dipanggil.");
}
export async function skipAction(prev: QueueState, f: FormData): Promise<QueueState> {
  const ticket = str(f, "ticket");
  if (!UUID.test(ticket)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return write(prev, f, async (db, key) => { await skipTicket(db, key, ticket); }, "Dilewati.");
}
export async function pairAction(prev: QueueState, f: FormData): Promise<QueueState> {
  const label = str(f, "label");
  if (label.length < 2 || label.length > 60) return done(prev, { error: COPY.label });
  // The token is returned once to this answer only (never stored, never in the idempotency record).
  return write(prev, f, async (db, key) => {
    const r = await pairDisplay(db, key, branchOf(f), label);
    return r.token ? { link: `${process.env.APP_URL ?? ""}/layar-antrean/${r.token}` } : {};
  }, "Layar dipasangkan. Buka tautan ini di layar TV sekarang; tautan tidak ditampilkan lagi.");
}
export async function revokeAction(prev: QueueState, f: FormData): Promise<QueueState> {
  const display = str(f, "display");
  if (!UUID.test(display)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return write(prev, f, async (db, key) => { await revokeDisplay(db, key, display); }, "Layar dicabut.");
}
