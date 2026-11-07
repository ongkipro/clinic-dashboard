// Saya › Akses Vendor data (UX-48, PR-60): one request in the active context. Owner and Admin Pusat
// read sessions, their access log and dual identities (the database functions refuse anyone else);
// the onboarding grant is the Owner's (onboarding_grant_status refuses Admin Pusat).
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { grantStatus, type GrantStatus } from "../../../../modules/vendor/onboarding/onboarding";
import { type DualIdentity, vendorDualIdentities } from "../../../../modules/vendor/staff/staff";
import { type OwnerSession, sessionLog, type SessionLog, sessionsForOwner } from "../../../../modules/vendor/support/scope";

export const READERS = ["owner", "admin_pusat"] as const;
export const LOG_PAGE = 50;

export type AksesVendorPage =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | {
      kind: "ok";
      isOwner: boolean;
      sessions: OwnerSession[];
      log: { sessionId: string; offset: number; data: SessionLog } | null; // the opened session's log page
      dual: DualIdentity[];
      grant: GrantStatus | null; // Owner only
      ctx: RenderedContext;
      result: string | null; // a verified result notice (see verifiedResult)
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The notice of the last decision (review round 1): only a known code whose subject's current state in
// this tenant's own data agrees with it. Unknown codes, prototype keys, foreign or stale ids show nothing.
const RESULT = new Map<string, string>([
  ["akses-disetujui", "Akses disetujui. Sesi aktif mulai sekarang."],
  ["akses-ditolak", "Akses ditolak. Sesi diakhiri."],
  ["sesi-diakhiri", "Sesi diakhiri. Vendor tidak bisa membaca data lagi lewat sesi ini."],
  ["identitas-disetujui", "Identitas ganda disetujui."],
  ["identitas-ditolak", "Identitas ganda ditolak."],
  ["identitas-dicabut", "Identitas ganda dicabut. Akun itu tidak lagi menjadi staf klinik ini."],
]);
export function verifiedResult(raw: string | undefined, sessions: OwnerSession[], dual: DualIdentity[]): string | null {
  const m = /^([a-z-]{1,32}):([0-9a-f-]{36})$/i.exec(raw ?? "");
  if (!m || !RESULT.has(m[1])) return null;
  const [, code, id] = m;
  const s = sessions.find((x) => x.id === id);
  const d = dual.find((x) => x.requestId === id);
  const holds =
    (code === "akses-disetujui" && s && s.state === "active" && s.activated_at !== null) ||
    (code === "akses-ditolak" && s && s.state === "ended" && s.activated_at === null && s.end_reason === "owner") ||
    (code === "sesi-diakhiri" && s && s.state === "ended" && s.end_reason === "owner") ||
    (code === "identitas-disetujui" && d && d.clinicApprovedAt !== null) ||
    (code === "identitas-ditolak" && d && d.state === "rejected") ||
    (code === "identitas-dicabut" && d && d.revokedAt !== null);
  return holds ? RESULT.get(code)! : null;
}

export async function loadAksesVendor(q: { sesi?: string; dari?: string; result?: string }): Promise<AksesVendorPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return rc;
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const role = rc.active.context.actingRole;
  if (!(READERS as readonly string[]).includes(role)) return { kind: "forbidden" };
  const isOwner = role === "owner";
  const offset = Math.max(0, Math.min(1_000_000, Number.parseInt(q.dari ?? "0", 10) || 0));
  return withTenantContext(await appPool(), rc.active.context, async (db) => {
    const sessions = await sessionsForOwner(db);
    let log: { sessionId: string; offset: number; data: SessionLog } | null = null;
    // Only a session of this tenant's list opens (another id reads as not found and is ignored).
    if (q.sesi && UUID.test(q.sesi) && sessions.some((s) => s.id === q.sesi)) {
      log = { sessionId: q.sesi, offset, data: await sessionLog(db, q.sesi, { offset, limit: LOG_PAGE }) };
    }
    const dual = await vendorDualIdentities(db);
    // Owner only (the function refuses other roles; it is never called for them).
    const grant: GrantStatus | null = isOwner ? await grantStatus(db) : null;
    return { kind: "ok" as const, isOwner, sessions, log, dual, grant, ctx: renderedContext(rc.active.context), result: verifiedResult(q.result, sessions, dual) };
  });
}
