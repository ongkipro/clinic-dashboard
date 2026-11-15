// Ekspor per penerima (UX-16, 19:184; T-087): one CSV row per recipient of a submitted batch — staff name and amounts only, no patient
// data. Readers: owner, finance, auditor; audited in the database (commission_batch_export).
import { withTenantContext } from "../../../../../../db/rls/context";
import { CommandError } from "../../../../../../lib/command";
import { exportBatch, exportCsv } from "../../../../../../modules/commission/commission";
import { appPool, requestContext } from "../../../../../../modules/org/context/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: RouteContext<"/komisi/batch/[id]/ekspor">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Tidak ditemukan", { status: 404 });
  const rc = await requestContext();
  if (rc.kind !== "ok") return new Response("Tidak ditemukan", { status: 404 });
  try {
    const rows = await withTenantContext(await appPool(), rc.active.context, (db) => exportBatch(db, id));
    return new Response(`\uFEFF${exportCsv(rows)}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="komisi-${id.slice(0, 8)}.csv"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof CommandError) return new Response("Tidak ditemukan", { status: 404 });
    throw e;
  }
}
