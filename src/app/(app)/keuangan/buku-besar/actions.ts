"use server";
// Jurnal & Buku Besar actions (UX-22 ▸ Buku Besar; T-105): Jurnal Manual and Kunci Periode (finance). Each refuses a form rendered in another
// context first (HYG-009 B2-1), carries the form's idempotency key (rotated after every answer: n) and lets the database decide authority,
// balance and the period rules.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { isCalendarDate, lockPeriod, postManual } from "../../../../modules/accounting/ledger/ledger";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export type FormState = { error?: string; ok?: string; n?: number; values?: Record<string, string> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya Keuangan yang dapat mengubah buku besar.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_PERIOD_LOCKED: "Periode itu sudah dikunci. Pilih tanggal di periode yang masih terbuka.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  unbalanced: "Total debit dan kredit harus sama.",
  line: "Setiap baris perlu akun yang ada dan tepat satu sisi (debit atau kredit).",
  "manual journal": "Isi tanggal, keterangan 10–500 karakter dan 2–20 baris.",
  period_open: "Hanya bulan yang sudah lewat yang dapat dikunci.",
  period_locked: "Periode itu sudah dikunci.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const money = (s: string) => (s === "" ? 0 : Number(s.replace(/[.\s]/g, "").replace(/^Rp/i, "")));
const next = (p: FormState, s: FormState): FormState => ({ ...s, n: (p.n ?? 0) + 1 });
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$") && k !== "key")) as Record<string, string>;
const message = (e: unknown) => {
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("buku-besar: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
async function context(f: FormData, p: FormState) {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: next(p, { error: COPY.ERR_FORBIDDEN }) };
  if (staleContext(f, rc.active.context)) return { error: next(p, { error: STALE_CONTEXT }) };
  return { c: rc.active.context };
}

export async function manualAction(p: FormState, f: FormData): Promise<FormState> {
  const bad = (error: string) => next(p, { error, values: keep(f) });
  const date = str(f, "date");
  const memo = str(f, "memo");
  const lines = [0, 1, 2, 3].map((i) => ({ account: str(f, `account${i}`), branchId: str(f, `branch${i}`) || null, debit: money(str(f, `debit${i}`)), credit: money(str(f, `credit${i}`)) }))
    .filter((l) => l.account !== "" || l.debit !== 0 || l.credit !== 0);
  if (!isCalendarDate(date)) return bad("Isi tanggal yang benar.");
  if (memo.length < 10 || memo.length > 500) return bad("Keterangan 10–500 karakter.");
  if (lines.length < 2) return bad("Isi sedikitnya dua baris.");
  if (lines.some((l) => !Number.isInteger(l.debit) || !Number.isInteger(l.credit) || l.debit < 0 || l.credit < 0 || (l.debit === 0) === (l.credit === 0) || !l.account)) return bad(REASON.line);
  if (lines.some((l) => l.branchId && !UUID.test(l.branchId))) return bad(COPY.ERR_INVALID_INPUT);
  if (lines.reduce((s, l) => s + l.debit - l.credit, 0) !== 0) return bad(REASON.unbalanced);
  const ctx = await context(f, p);
  if ("error" in ctx) return ctx.error!;
  const key = str(f, "key");
  if (!UUID.test(key)) return bad(COPY.ERR_INVALID_INPUT);
  try {
    await withTenantContext(await appPool(), ctx.c, (db) => postManual(db, key, { date, memo, lines }));
  } catch (e) {
    return bad(message(e));
  }
  revalidatePath("/keuangan/buku-besar");
  return next(p, { ok: "Jurnal manual dicatat (pratinjau)." });
}

export async function lockAction(p: FormState, f: FormData): Promise<FormState> {
  const period = str(f, "period");
  if (!PERIOD.test(period)) return next(p, { error: "Pilih bulan yang akan dikunci." });
  const ctx = await context(f, p);
  if ("error" in ctx) return ctx.error!;
  const key = str(f, "key");
  if (!UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  try {
    await withTenantContext(await appPool(), ctx.c, (db) => lockPeriod(db, key, period));
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath("/keuangan/buku-besar");
  return next(p, { ok: `Periode ${period} dikunci.` });
}
