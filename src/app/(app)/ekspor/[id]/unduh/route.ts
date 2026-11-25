// Guarded tenant export download endpoint (PR-52, UX-32; T-122).
// Closes Findings #3, #4, #6, #7, #8 of t122/PLAN-REVIEW-codex-panel3.md:
// - POST ONLY (GET and HEAD explicitly refused 405 with Cache-Control: private, no-store).
// - Enforces same-origin POST, requestContext(), ContextFields (staleContext), and HYG-026 fresh step-up.
// - Never accepts credentials in URL query parameters or browser-supplied step-up proofs.
// - Delegates full manifest/byte integrity + post-integrity success audit / denial audit to releaseTenantExport.
import { getAuth } from "../../../../../auth/instance";
import { CommandError } from "../../../../../lib/command";
import { releaseTenantExport } from "../../../../../modules/export/tenant.export";
import { STALE_CONTEXT, staleContext } from "../../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../../modules/org/context/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

export async function GET(): Promise<Response> {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { ...NO_STORE, allow: "POST" },
  });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, {
    status: 405,
    headers: { ...NO_STORE, allow: "POST" },
  });
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export async function POST(req: Request, ctx: RouteContext<"/ekspor/[id]/unduh">): Promise<Response> {
  if (!sameOrigin(req)) {
    return errorResponse(403, "ERR_FORBIDDEN", "Permintaan lintas asal ditolak.");
  }

  const { id } = await ctx.params;
  if (!UUID.test(id)) {
    return errorResponse(404, "ERR_NOT_FOUND", "Ekspor tidak ditemukan.");
  }

  const rc = await requestContext();
  if (rc.kind === "redirect") {
    return errorResponse(401, "ERR_UNAUTHENTICATED", "Sesi tidak aktif. Masuk kembali.");
  }
  if (rc.kind === "blocked") {
    return errorResponse(403, "ERR_FORBIDDEN", "Ekspor penuh hanya untuk Owner.");
  }

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return errorResponse(400, "ERR_INVALID_INPUT", "Isian formulir tidak sah.");
  }

  if (staleContext(fd, rc.active.context)) {
    return errorResponse(409, "ERR_VERSION_CONFLICT", STALE_CONTEXT);
  }

  const code = typeof fd.get("totp_code") === "string" ? (fd.get("totp_code") as string).trim() : "";
  const auth = await getAuth();
  const proof = code ? await auth.stepUp(req.headers, code) : await auth.freshStepUp(req.headers);
  if (!proof) {
    return errorResponse(403, "ERR_FORBIDDEN", "Verifikasi TOTP terbaru diperlukan untuk mengunduh ekspor.");
  }

  try {
    const out = await releaseTenantExport(await appPool(), rc.active.context, id, proof);
    return new Response(Buffer.from(out.zip), {
      status: 200,
      headers: {
        ...NO_STORE,
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${out.fileName}"`,
        "content-length": String(out.sizeBytes),
      },
    });
  } catch (e) {
    if (e instanceof CommandError) {
      const status =
        e.code === "ERR_NOT_FOUND"
          ? 404
          : e.code === "ERR_FORBIDDEN"
            ? 403
            : e.code === "ERR_EXPIRED"
              ? 410
              : e.code === "ERR_RATE_LIMITED"
                ? 429
                : 409;
      return errorResponse(status, e.code, "Ekspor tidak dapat diunduh.");
    }
    console.error("ekspor: download failed", { error: e instanceof Error ? e.name : "unknown" });
    return errorResponse(500, "ERR_INTERNAL", "Unduhan gagal diproses.");
  }
}
