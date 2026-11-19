// Ekspor Coretax (UX-22 ▸ Pajak, PR-98; T-106): one XML document of one tax month, downloaded by owner or finance. The database refuses
// (409, with the reason; Scenario PR-98 names the missing evidence) unless the tenant has an NPWP, is PKP for that month and the coretax_export
// gate is open; every refusal and download is audited there, and a download is logged with the SHA-256 of these exact bytes.
import { withTenantContext } from "../../../../../db/rls/context";
import { CommandError } from "../../../../../lib/command";
import { DOC_KINDS, type DocKind, exportCoretax, isPeriod } from "../../../../../modules/accounting/coretax/coretax";
import { appPool, requestContext } from "../../../../../modules/org/context/store";
import { DOC, REFUSED } from "../labels";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const period = q.get("masa") ?? "";
  const kind = (q.get("dokumen") ?? "") as DocKind;
  if (!isPeriod(period) || !DOC_KINDS.includes(kind)) return new Response("Permintaan tidak valid", { status: 400 });
  const rc = await requestContext();
  if (rc.kind !== "ok") return new Response("Tidak ditemukan", { status: 404 });
  try {
    const r = await withTenantContext(await appPool(), rc.active.context, (db) => exportCoretax(db, { period, kind }));
    if (!r.ok) {
      const why = r.refused === "gate_closed" && r.missing?.length ? `${REFUSED.gate_closed}: ${r.missing.join(", ")}` : REFUSED[r.refused];
      return new Response(why, { status: 409, headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response(r.xml, {
      headers: {
        ...NO_STORE,
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${DOC[kind].file}-${period}.xml"`,
        "x-content-type-options": "nosniff",
        "x-content-sha256": r.sha256,
      },
    });
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return new Response("Tidak diizinkan", { status: 403 });
    if (e instanceof CommandError && e.code === "ERR_INVALID_INPUT") return new Response("Permintaan tidak valid", { status: 400 });
    if (e instanceof CommandError) return new Response("Tidak ditemukan", { status: 404 });
    throw e;
  }
}
