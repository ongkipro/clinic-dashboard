"use server";
// Komisi actions (UX-16; T-087): Buka Batch, Ajukan Persetujuan, Tandai Dibayar, Putuskan Piutang Staf; Aturan Komisi: Siapkan Aturan,
// Versi Baru, Berlakukan / Batalkan Draf; the simulator. Each refuses a form rendered in another context first (HYG-009 B2-1), carries the
// form's idempotency key where the command is keyed (rotated after every answer: n) and lets the database decide authority and money
// (DEC-099). Setujui Batch happens in Persetujuan (commission_batch; the approver is never the requester).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import {
  type ContributionType, createRule, decideRuleVersion, decideStaffReceivable, markBatchPaid, newRuleVersion, openBatch, type RuleValue, type Simulation,
  simulateRule, submitBatch,
} from "../../../modules/commission/commission";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type KomisiState = { error?: string; ok?: string; n?: number; values?: Record<string, string>; go?: string; sim?: Simulation };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ["closing_bc", "guiding_bc", "new_patient", "performer"];
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah diubah orang lain. Muat ulang lalu coba lagi.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengubah konfigurasi.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  period_open: "Bulan ini belum selesai. Batch diajukan setelah tanggal tutup.",
  earlier_batch_open: "Batch bulan sebelumnya belum diajukan atau disetujui.",
  not_draft: "Batch atau draf ini sudah diproses.",
  not_approved: "Batch belum disetujui Owner.",
  period: "Pilih bulan.",
  period_in_future: "Bulan ini belum bisa dibuka.",
  decided: "Piutang ini sudah diputuskan.",
  decision: "Tulis alasan (3–500 karakter).",
  rule: "Periksa jenis, nilai dan tanggal berlaku aturan.",
  simulation: "Pilih item dan isi harga.",
  "item not found": "Item tidak ditemukan atau belum aktif.",
  "staff not found": "Staf tidak ditemukan.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const money = (s: string) => Number(s.replace(/[.\s]/g, "").replace(/^Rp/i, ""));
const next = (p: KomisiState, s: KomisiState): KomisiState => ({ ...s, n: (p.n ?? 0) + 1 });
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$") && k !== "key")) as Record<string, string>;
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) {
    const r = (e as { reason?: string }).reason ?? "";
    return REASON[r] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  }
  console.error("komisi: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: KomisiState, f: FormData, fn: (db: Db, key: string) => Promise<R>, done: (r: R) => KomisiState, keyed = true): Promise<KomisiState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  const key = str(f, "key");
  if (keyed && !UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT, values: keep(f) });
  let r: R;
  try {
    r = await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key));
  } catch (e) {
    return next(p, { error: message(e), values: keep(f) });
  }
  revalidatePath("/komisi", "layout");
  const out = done(r);
  if (out.go) redirect(out.go);
  return next(p, out);
}

// ── Rekap Komisi & Batch ──
export async function openBatchAction(p: KomisiState, f: FormData): Promise<KomisiState> {
  const period = str(f, "period");
  if (!MONTH.test(period)) return next(p, { error: REASON.period });
  return run(p, f, (db, key) => openBatch(db, key, period), (r) => ({ ok: "Batch dibuka.", go: `/komisi/batch/${r.batchId}` }));
}
export async function submitBatchAction(p: KomisiState, f: FormData): Promise<KomisiState> {
  const batch = str(f, "batch");
  if (!UUID.test(batch)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db) => submitBatch(db, batch), () => ({ go: `/komisi/batch/${batch}?diajukan=1` }), false);
}
export async function markPaidAction(p: KomisiState, f: FormData): Promise<KomisiState> {
  const batch = str(f, "batch");
  const method = str(f, "method");
  if (!UUID.test(batch)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (method !== "cash" && method !== "transfer") return next(p, { error: "Pilih cara bayar." });
  return run(p, f, (db) => markBatchPaid(db, batch, method), () => ({ go: `/komisi/batch/${batch}?dibayar=1` }), false);
}
export async function decideReceivableAction(p: KomisiState, f: FormData): Promise<KomisiState> {
  const id = str(f, "receivable");
  const state = str(f, "state");
  const reason = str(f, "reason");
  if (!UUID.test(id) || (state !== "settled" && state !== "waived")) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (reason.length < 3 || reason.length > 500) return next(p, { error: REASON.decision, values: keep(f) });
  return run(p, f, (db) => decideStaffReceivable(db, id, state, reason), () => ({ go: `/komisi?piutang=${state === "settled" ? "lunas" : "dihapuskan"}` }), false);
}

// ── Aturan Komisi ──
function ruleValue(f: FormData): (RuleValue & { effectiveFrom: string | null }) | string {
  const kind = str(f, "kind");
  const from = str(f, "effective_from");
  if (from && !DAY.test(from)) return "Isi tanggal berlaku.";
  // the date is a WIB calendar day: from 00:00 Asia/Jakarta
  const effectiveFrom = from ? `${from}T00:00:00+07:00` : null;
  if (kind === "percent") {
    const pct = Number(str(f, "percent").replace(",", "."));
    const bps = Math.round(pct * 100);
    if (!Number.isFinite(pct) || bps < 1 || bps > 10_000 || Math.abs(pct * 100 - bps) > 1e-9) return "Isi persen 0,01–100 (maksimal dua desimal).";
    return { kind, basisPoints: bps, effectiveFrom };
  }
  if (kind === "fixed") {
    const amount = money(str(f, "amount"));
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000_000) return "Isi nominal rupiah.";
    return { kind, fixedAmount: amount, effectiveFrom };
  }
  return "Pilih bentuk nilai (persen atau nominal).";
}
export async function createRuleAction(p: KomisiState, f: FormData): Promise<KomisiState> {
  const type = str(f, "contribution_type");
  const name = str(f, "name");
  const role = str(f, "role");
  const staff = str(f, "staff");
  const item = str(f, "item");
  const priority = str(f, "priority");
  const bad = (error: string) => next(p, { error, values: keep(f) });
  if (!TYPES.includes(type)) return bad("Pilih jenis kontribusi.");
  if (name.length < 2 || name.length > 80) return bad("Tulis nama aturan (2–80 karakter).");
  if ((staff && !UUID.test(staff)) || (item && !UUID.test(item))) return bad(COPY.ERR_INVALID_INPUT);
  if (priority && !/^-?\d{1,3}$/.test(priority)) return bad("Prioritas -100 sampai 100.");
  const v = ruleValue(f);
  if (typeof v === "string") return bad(v);
  return run(p, f, (db, key) => createRule(db, key, { ...v, contributionType: type as ContributionType, name, role: role || null, staffId: staff || null,
    catalogItemId: item || null, priority: priority ? Number(priority) : undefined }), () => ({ ok: "Draf aturan disimpan. Owner memberlakukannya." }));
}
export async function newVersionAction(p: KomisiState, f: FormData): Promise<KomisiState> {
  const rule = str(f, "rule");
  if (!UUID.test(rule)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const v = ruleValue(f);
  if (typeof v === "string") return next(p, { error: v, values: keep(f) });
  return run(p, f, (db, key) => newRuleVersion(db, key, rule, v), () => ({ ok: "Draf versi baru disimpan. Owner memberlakukannya." }));
}
export async function decideVersionAction(p: KomisiState, f: FormData): Promise<KomisiState> {
  const version = str(f, "version");
  const action = str(f, "action");
  if (!UUID.test(version) || (action !== "activate" && action !== "cancel")) return next(p, { error: COPY.ERR_INVALID_INPUT });
  // the decided draft leaves the page (its form unmounts), so the answer is shown by the page itself
  return run(p, f, (db) => decideRuleVersion(db, version, action), () => ({ go: `/komisi/aturan?${action === "activate" ? "diberlakukan" : "dibatalkan"}=1` }), false);
}
export async function simulateAction(p: KomisiState, f: FormData): Promise<KomisiState> {
  const item = str(f, "item");
  const price = money(str(f, "price"));
  const at = str(f, "at");
  if (!UUID.test(item)) return next(p, { error: REASON.simulation, values: keep(f) });
  if (!Number.isInteger(price) || price < 1 || price > 1_000_000_000_000) return next(p, { error: REASON.simulation, values: keep(f) });
  if (at && !DAY.test(at)) return next(p, { error: "Isi tanggal penjualan.", values: keep(f) });
  const id = (k: string) => (UUID.test(str(f, k)) ? str(f, k) : null);
  // read-only: no revalidation needed, but run() revalidates harmlessly; keep the values so the form shows what was simulated
  return run(p, f, (db) => simulateRule(db, { itemId: item, price, at: at ? `${at}T12:00:00+07:00` : null, closingBcId: id("closing"), guidingBcId: id("guiding"),
    registrarId: id("registrar"), performerId: id("performer") }), (sim) => ({ sim, values: keep(f) }), false);
}
