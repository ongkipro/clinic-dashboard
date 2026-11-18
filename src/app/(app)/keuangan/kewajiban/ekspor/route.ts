// Ekspor Kewajiban (UX-22 ▸ Kewajiban primary action, A-14; T-104): one CSV per sub-ledger or transaction set for a period — ids, document
// numbers, branch codes, amounts and commission recipients only; no journal (step 2), no patient or clinical data. Owner and finance; the
// auditor reads without export. Audited in the database (subledger_export).
import { withTenantContext } from "../../../../../db/rls/context";
import { CommandError } from "../../../../../lib/command";
import { EXPORT_KINDS, type ExportKind, exportRows, isCalendarDate, toCsv } from "../../../../../modules/accounting/subledgers/subledgers";
import { appPool, requestContext } from "../../../../../modules/org/context/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const kind = q.get("jenis") ?? "";
  const from = q.get("dari") ?? "";
  const to = q.get("sampai") ?? "";
  const branch = q.get("cabang") || null;
  const staff = q.get("staf") || null;
  if (!EXPORT_KINDS.includes(kind as ExportKind) || !isCalendarDate(from) || !isCalendarDate(to) || (branch && !UUID.test(branch)) || (staff && !UUID.test(staff))) {
    return new Response("Permintaan tidak valid", { status: 400 });
  }
  const rc = await requestContext();
  if (rc.kind !== "ok") return new Response("Tidak ditemukan", { status: 404 });
  try {
    const rows = await withTenantContext(await appPool(), rc.active.context, (db) => exportRows(db, { kind: kind as ExportKind, from, to, branchId: branch, staffId: staff }));
    return new Response(`\uFEFF${toCsv(rows)}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="kewajiban-${kind}-${from}-${to}.csv"`,
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
