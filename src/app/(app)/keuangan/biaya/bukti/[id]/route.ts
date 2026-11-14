// The receipt of one expense (PR-79; T-084): its readers only, audited in the database (expense_receipt). An image is shown inline
// (the receipt preview); a PDF downloads. The stored type was checked against the bytes at upload (expenses_guard: media_sniff).
import { withTenantContext } from "../../../../../../db/rls/context";
import { CommandError } from "../../../../../../lib/command";
import { expenseReceipt } from "../../../../../../modules/expenses/expenses";
import { appPool, requestContext } from "../../../../../../modules/org/context/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: RouteContext<"/keuangan/biaya/bukti/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Tidak ditemukan", { status: 404 });
  const rc = await requestContext();
  if (rc.kind !== "ok") return new Response("Tidak ditemukan", { status: 404 });
  try {
    const f = await withTenantContext(await appPool(), rc.active.context, (db) => expenseReceipt(db, id));
    if (!f) return new Response("Tidak ditemukan", { status: 404 });
    const inline = f.media_type === "image/png" || f.media_type === "image/jpeg";
    return new Response(new Uint8Array(f.content), {
      headers: {
        "content-type": f.media_type,
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${f.file_name.replace(/[^\w.-]/g, "_")}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof CommandError) return new Response("Tidak ditemukan", { status: 404 });
    throw e;
  }
}
