// Ekspor Jurnal (UX-22 ▸ Buku Besar; T-105, A-14): the CSV journal (date, branch code, account, debit, credit, reference) — refused unless the
// posting map version is signed by the accountant AND the books are activated (open gate G-ACT: never in T-105). Finance only; the refusal and
// the export are audited in the database.
import { withTenantContext } from "../../../../../db/rls/context";
import { CommandError } from "../../../../../lib/command";
import { exportJournal, isCalendarDate } from "../../../../../modules/accounting/ledger/ledger";
import { appPool, requestContext } from "../../../../../modules/org/context/store";

const REFUSED = { posting_map_unsigned: "Posting map belum ditandatangani", ledger_not_activated: "Buku belum diaktifkan" } as const;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const from = q.get("dari") ?? "";
  const to = q.get("sampai") ?? "";
  if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) return new Response("Permintaan tidak valid", { status: 400 });
  const rc = await requestContext();
  if (rc.kind !== "ok") return new Response("Tidak ditemukan", { status: 404 });
  try {
    const r = await withTenantContext(await appPool(), rc.active.context, (db) => exportJournal(db, { from, to }));
    if (!r.ok) return new Response(REFUSED[r.refused], { status: 409, headers: { "cache-control": "private, no-store" } });
    return new Response(r.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="jurnal-${from}-${to}.csv"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return new Response("Tidak diizinkan", { status: 403 });
    if (e instanceof CommandError && e.code === "ERR_INVALID_INPUT") return new Response("Permintaan tidak valid", { status: 400 });
    if (e instanceof CommandError) return new Response("Tidak ditemukan", { status: 404 });
    throw e;
  }
}
