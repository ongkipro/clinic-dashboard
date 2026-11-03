// Console writes (T-023, PR-1, DEC-033). JSON POST only (src/proxy.ts refuses anything
// else on this path), same Origin as VENDOR_URL, a vendor-surface session with verified
// TOTP; the database runs vendor_guard (role, IP allowlist, 10-minute step-up) and logs
// every outcome. The body is validated here for shape only; the database validates values.
import { NextResponse } from "next/server";
import { ipHeader, vendorAuth, vendorOrigin, vendorPool } from "../../../_lib/server";
import { AccountExistsError, PasswordPolicyError } from "../../../../../auth/server";
import { acceptMemberWithNewAccount, cancelMemberInvite, inviteMember, setMemberState } from "../../../../../modules/vendor/team/team";
import {
  advanceTenant, approveOwnerInvite, cancelOwnerInvite, type ConsoleCall, createTenant, requestOwnerInvite,
} from "../../../../../modules/vendor/tenants/tenants";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (v: unknown, max = 254) => (typeof v === "string" && v.length <= max ? v : "");
const uuid = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  if (request.headers.get("origin") !== vendorOrigin()) return json({ ok: false, code: "ERR_FORBIDDEN" }, 403);
  const { action } = await params;
  // Accepting a Tim Vendor invitation (DEC-036) is the one action without a session: the
  // token names the invitation; a new account for the invited email is created with the
  // IAM-1 policy and removed again when accepting is refused.
  if (action === "staff-invite-accept") {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const token = str(body?.token, 64);
    const password = str(body?.password, 128);
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token) || !password) return json({ ok: false, code: "ERR_INVALID_INPUT" }, 400);
    try {
      const r = await acceptMemberWithNewAccount(await vendorPool(), await vendorAuth(), token, password);
      return r.ok ? json({ ok: true }) : json({ ok: false, code: "ERR_NOT_FOUND" }, 404);
    } catch (e) {
      if (e instanceof PasswordPolicyError) return json({ ok: false, code: "PASSWORD_POLICY", message: e.message }, 400);
      if (e instanceof AccountExistsError) return json({ ok: false, code: "ACCOUNT_EXISTS" }, 409);
      throw e;
    }
  }
  const s = await (await vendorAuth()).checkSession(request.headers);
  if (s.gate !== "ok") return json({ ok: false, code: "ERR_UNAUTHENTICATED" }, 401);
  const c: ConsoleCall = { token: s.token, ip: request.headers.get(ipHeader()) ?? "" };
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return json({ ok: false, code: "ERR_INVALID_INPUT" }, 400);
  const db = await vendorPool();
  let r;
  switch (action) {
    case "tenant-create":
      r = await createTenant(db, c, {
        legalName: str(body.legalName, 160), sak: str(body.sak, 8) as "emkm", branchCode: str(body.branchCode, 8),
        branchName: str(body.branchName, 120), timezone: str(body.timezone, 32) as "Asia/Jakarta",
        ownerName: str(body.ownerName, 120), ownerEmail: str(body.ownerEmail),
      });
      break;
    // A malformed id goes to the database as NULL: the guard runs (and logs) as for any
    // other refusal, then the function refuses not-found.
    case "owner-invite": {
      r = await requestOwnerInvite(db, c, uuid(body.tenantId), str(body.ownerName, 120), str(body.ownerEmail));
      break;
    }
    case "owner-invite-approve": {
      r = await approveOwnerInvite(db, c, uuid(body.invitationId));
      // The link is shown once, to the approver; never logged or stored.
      if (r.ok) return json({ ok: true, link: `${process.env.APP_URL ?? ""}/undangan/${r.data.token}` });
      break;
    }
    case "owner-invite-cancel": {
      r = await cancelOwnerInvite(db, c, uuid(body.invitationId));
      break;
    }
    case "tenant-advance": {
      r = await advanceTenant(db, c, uuid(body.tenantId), str(body.to, 16), str(body.reason, 500));
      break;
    }
    case "session-end": {
      // Profil & Keamanan › Sesi Aktif on the vendor host: one of this account's other
      // vendor sessions (endOwnSession refuses the current one and anyone else's).
      const id = uuid(body.sessionId);
      if (!id) return json({ ok: false, code: "ERR_INVALID_INPUT" }, 400);
      const ended = await (await vendorAuth()).endOwnSession(request.headers, id);
      return ended ? json({ ok: true }) : json({ ok: false, code: "ERR_NOT_FOUND" }, 404);
    }
    case "staff-invite": {
      const roles = Array.isArray(body.roles) ? body.roles.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
      r = await inviteMember(db, c, str(body.email), str(body.name, 120), roles);
      if (r.ok) return json({ ok: true, link: `${vendorOrigin()}/vendor/undangan/${r.data.token}` });
      break;
    }
    case "staff-invite-cancel":
      r = await cancelMemberInvite(db, c, uuid(body.invitationId));
      break;
    case "staff-state":
      r = await setMemberState(db, c, uuid(body.staffId), str(body.state, 16));
      break;
    default:
      return json({ ok: false, code: "ERR_NOT_FOUND" }, 404);
  }
  if (!r.ok) return json({ ok: false, code: r.code, reason: r.reason }, r.code === "ERR_INVALID_INPUT" ? 400 : r.code === "ERR_NOT_FOUND" ? 404 : r.code === "ERR_FORBIDDEN" ? 403 : 409);
  return json({ ok: true, ...(r.data as object), r: undefined });
}
