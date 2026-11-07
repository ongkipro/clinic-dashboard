"use server";
// Saya › Akses Vendor actions (UX-48, PR-60, TEN-14): Setujui / Tolak a support session's scope,
// Akhiri Sesi, and the clinic's half of a dual identity. The database decides (Owner only, tenant,
// state); a refusal it returns is committed (audited) and shown. Each form posts the context it was
// rendered in and is refused first when another tab changed it (HYG-009 B2-1). On success the page is
// reloaded and shows a fixed notice from a one-use server cookie (see done()).
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { vendorDualIdentityClinicDecide, vendorDualIdentityClinicRevoke } from "../../../../modules/vendor/staff/staff";
import { decideScope } from "../../../../modules/vendor/support/scope";
import { endSessionAsOwner } from "../../../../modules/vendor/support/support";
import { RESULT_COOKIE } from "./result-cookie";

export type AksesState = { error?: string; ok?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya Owner yang dapat memutuskan akses vendor.",
  ERR_NOT_FOUND: "Data ini sudah berubah. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Permintaan ini sudah diputuskan. Muat ulang halaman.",
  ERR_APPROVER_IS_REQUESTER: "Akun Anda sendiri yang mengajukan; minta Owner lain atau tolak.",
  ERR_INVALID_INPUT: "Pilihan tidak valid.",
  not_pending: "Sesi ini sudah tidak menunggu persetujuan. Muat ulang halaman.",
  tenant_closed: "Klinik sudah ditutup; sesi tidak dapat disetujui.",
  operator_inactive: "Petugas vendor itu sudah tidak aktif; sesi tidak dapat disetujui.",
  approver_is_requester: "Akun Anda sendiri yang mengajukan sesi ini; Anda hanya dapat menolaknya.",
  not_found: "Sesi tidak ditemukan. Muat ulang halaman.",
  // Cabut identitas ganda (HYG-013).
  ERR_FORBIDDEN_SELF: "Anda tidak dapat mencabut identitas ganda Anda sendiri; minta Owner lain.",
  revoke_not_effective: "Identitas ganda ini sudah tidak berlaku. Muat ulang halaman.",
};

// The success notice (review round 1): a short-lived (60 s) httpOnly cookie set only after the database
// committed the decision, scoped to this page. It is not cleared (a Server Component cannot set cookies);
// the page shows it only while the subject's current state agrees. A URL can no longer claim a result.
async function done(code: string, subject: string): Promise<never> {
  // `<code>:<subject id>`: the page shows the notice only when the database state of that subject
  // agrees (an ended session, an active one, a decided dual identity), so a stale or forged cookie
  // shows nothing.
  (await cookies()).set(RESULT_COOKIE, `${code}:${subject}`, { httpOnly: true, sameSite: "strict", secure: process.env.APP_URL?.startsWith("https://") ?? true, path: "/saya/akses-vendor", maxAge: 60 });
  revalidatePath("/saya/akses-vendor");
  redirect("/saya/akses-vendor");
}

async function run(f: FormData, fn: Parameters<typeof withTenantContext>[2]): Promise<AksesState | null> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  try {
    const r = (await withTenantContext(await appPool(), rc.active.context, fn)) as AksesState | null | undefined;
    return r ?? null;
  } catch (e) {
    if (e instanceof CommandError) return { error: COPY[e.code] ?? COPY.ERR_FORBIDDEN };
    const code = (e as { code?: string }).code;
    if (code === "P0002") return { error: COPY.ERR_NOT_FOUND };
    if (code === "42501") return { error: COPY.ERR_FORBIDDEN };
    throw e;
  }
}

export async function decideScopeAction(_p: AksesState, f: FormData): Promise<AksesState> {
  const id = String(f.get("session") ?? "");
  const decision = f.get("decision");
  if (!UUID.test(id) || (decision !== "approve" && decision !== "reject")) return { error: COPY.ERR_INVALID_INPUT };
  const r = await run(f, async (db) => {
    const d = await decideScope(db, id, decision === "approve");
    return d.ok ? null : { error: COPY[d.reason] ?? COPY[d.code] ?? COPY.ERR_FORBIDDEN };
  });
  if (r) return r;
  // The decided card leaves the list on re-render (its form with it), so the result is shown by the page.
  return done(decision === "approve" ? "akses-disetujui" : "akses-ditolak", id);
}

export async function endSessionAction(_p: AksesState, f: FormData): Promise<AksesState> {
  const id = String(f.get("session") ?? "");
  if (!UUID.test(id)) return { error: COPY.ERR_INVALID_INPUT };
  const r = await run(f, async (db) => {
    await endSessionAsOwner(db, id);
    return null;
  });
  if (r) return r;
  return done("sesi-diakhiri", id);
}

export async function decideDualIdentityAction(_p: AksesState, f: FormData): Promise<AksesState> {
  const id = String(f.get("request") ?? "");
  const decision = f.get("decision");
  if (!UUID.test(id) || (decision !== "approve" && decision !== "reject")) return { error: COPY.ERR_INVALID_INPUT };
  const r = await run(f, async (db) => {
    const d = await vendorDualIdentityClinicDecide(db, id, decision === "approve");
    return typeof d === "string" ? null : { error: COPY[d.refused] ?? COPY.ERR_FORBIDDEN };
  });
  if (r) return r;
  return done(decision === "approve" ? "identitas-disetujui" : "identitas-ditolak", id);
}

// Cabut (HYG-013, DEC-044): the Owner revokes an effective dual identity; the database ends that
// account's clinic membership here at the same moment.
export async function revokeDualIdentityAction(_p: AksesState, f: FormData): Promise<AksesState> {
  const id = String(f.get("request") ?? "");
  if (!UUID.test(id)) return { error: COPY.ERR_INVALID_INPUT };
  const r = await run(f, async (db) => {
    const d = await vendorDualIdentityClinicRevoke(db, id);
    if (typeof d === "string") return null;
    return { error: d.refused === "ERR_VERSION_CONFLICT" ? COPY.revoke_not_effective : COPY[d.refused] ?? COPY.ERR_FORBIDDEN };
  });
  if (r) return r;
  return done("identitas-dicabut", id);
}
