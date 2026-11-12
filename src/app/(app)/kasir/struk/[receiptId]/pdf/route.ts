// The PDF of a receipt (BILL-19): the Kasir readers of its branch (receipt_get; the auditor masked). Served as an
// attachment; never cached.
import { withTenantContext } from "../../../../../../db/rls/context";
import { CommandError } from "../../../../../../lib/command";
import { getReceipt } from "../../../../../../modules/cashier/kasir/kasir";
import { renderPdf } from "../../../../../../modules/clinical/records/pdf";
import { appPool, requestContext } from "../../../../../../modules/org/context/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: RouteContext<"/kasir/struk/[receiptId]/pdf">) {
  const { receiptId } = await ctx.params;
  if (!UUID.test(receiptId)) return new Response("Tidak ditemukan", { status: 404 });
  const rc = await requestContext();
  if (rc.kind !== "ok") return new Response("Tidak ditemukan", { status: 404 });
  try {
    const r = await withTenantContext(await appPool(), rc.active.context, (db) => getReceipt(db, receiptId));
    const pdf = renderPdf(r.body.split("\n").map((t, i) => ({ text: t, bold: i === 0 })));
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="struk-${r.number}.pdf"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof CommandError) return new Response("Tidak ditemukan", { status: 404 });
    throw e;
  }
}
