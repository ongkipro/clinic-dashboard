// Download of one breach notice's evidence file (PR-92): the privacy officers only, audited in the database
// (breach_notice_file). Served as an attachment with its stored type; never rendered inline.
import { withTenantContext } from "../../../../../db/rls/context";
import { CommandError } from "../../../../../lib/command";
import { appPool, requestContext } from "../../../../../modules/org/context/store";
import { noticeFile } from "../../../../../modules/privacy/privacy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: RouteContext<"/privasi/bukti/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Tidak ditemukan", { status: 404 });
  const rc = await requestContext();
  if (rc.kind !== "ok") return new Response("Tidak ditemukan", { status: 404 });
  try {
    const f = await withTenantContext(await appPool(), rc.active.context, (db) => noticeFile(db, id));
    return new Response(new Uint8Array(f.content), {
      headers: {
        "content-type": f.mediaType,
        "content-disposition": `attachment; filename="${f.fileName.replace(/[^\w.-]/g, "_")}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        "x-checksum-sha256": f.sha256,
      },
    });
  } catch (e) {
    if (e instanceof CommandError) return new Response("Tidak ditemukan", { status: 404 });
    throw e;
  }
}
