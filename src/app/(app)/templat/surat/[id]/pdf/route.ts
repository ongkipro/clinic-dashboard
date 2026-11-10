// The PDF of a signed letter (PR-74): the letter readers of the branch, audited in the database (letter_get).
// Served as an attachment; never cached.
import { withTenantContext } from "../../../../../../db/rls/context";
import { CommandError } from "../../../../../../lib/command";
import { getLetter, letterPdf } from "../../../../../../modules/documents/documents";
import { appPool, requestContext } from "../../../../../../modules/org/context/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: RouteContext<"/templat/surat/[id]/pdf">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Tidak ditemukan", { status: 404 });
  const rc = await requestContext();
  if (rc.kind !== "ok") return new Response("Tidak ditemukan", { status: 404 });
  try {
    const pdf = await withTenantContext(await appPool(), rc.active.context, async (db) => letterPdf(await getLetter(db, id)));
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="surat-${id.slice(0, 8)}.pdf"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof CommandError) return new Response("Tidak ditemukan", { status: 404 });
    throw e;
  }
}
