// Console writes (T-023, PR-1, DEC-033). JSON POST only (src/proxy.ts refuses anything
// else on this path), same Origin as VENDOR_URL, a vendor-surface session with verified
// TOTP; the database runs vendor_guard (role, IP allowlist, 10-minute step-up) and logs
// every outcome. The body is validated here for shape only; the database validates values.
import { NextResponse } from "next/server";
import { ipHeader, vendorAuth, vendorOrigin, vendorPool } from "../../../_lib/server";
import { AccountExistsError, PasswordPolicyError } from "../../../../../auth/server";
import { acceptMemberWithNewAccount, cancelMemberInvite, inviteMember, setMemberState } from "../../../../../modules/vendor/team/team";
import { setChecklistItem } from "../../../../../modules/vendor/checklist/checklist";
import { cancelBilling, decideBilling, issueBilling, noteAttempt, requestBilling } from "../../../../../modules/vendor/billing/console";
import { exportVendorActionsCsv } from "../../../../../modules/vendor/console/audit.export";
import { saveLegalTemplate } from "../../../../../modules/vendor/console/console";
import {
  advanceTenant, approveOwnerInvite, cancelOwnerInvite, type ConsoleCall, createTenant, requestOwnerInvite,
} from "../../../../../modules/vendor/tenants/tenants";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Strict Gregorian ISO-8601 within PostgreSQL timestamptz safe bounds (years 0001..9999, timezone offsets -14:00..+14:00),
// preserving full microsecond precision as canonical UTC ISO string + exact BigInt microseconds for range comparison.
const ISO_TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(0\d|1[0-4]):([0-5]\d))$/;
const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, mo: number) => (mo === 2 ? (isLeapYear(y) ? 29 : 28) : mo === 4 || mo === 6 || mo === 9 || mo === 11 ? 30 : 31);
const pad = (n: number, len = 2) => String(n).padStart(len, "0");
type ParsedTs = { iso: string; wholeSecMs: number; us: number };
const isoTimestamp = (v: unknown): ParsedTs | null => {
  if (typeof v !== "string" || v.length > 40) return null;
  const m = ISO_TS.exec(v);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]), s = Number(m[6]);
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return null;
  if (m[9] === "14" && m[10] !== "00") return null;
  const us = Number((m[7] ?? "").padEnd(6, "0"));
  const offMin = m[8] ? (m[8] === "+" ? 1 : -1) * (Number(m[9]) * 60 + Number(m[10])) : 0;
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi, s, 0);
  const wholeSecMs = dt.getTime() - offMin * 60_000;
  if (!Number.isFinite(wholeSecMs)) return null;
  const utc = new Date(wholeSecMs);
  const uy = utc.getUTCFullYear();
  if (uy < 1 || uy > 9999) return null;
  const frac = us === 0 ? "" : `.${pad(us, 6)}`;
  const iso = `${pad(uy, 4)}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}T${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}${frac}Z`;
  return { iso, wholeSecMs, us };
};
const str = (v: unknown, max = 254) => (typeof v === "string" && v.length <= max ? v : "");
const uuid = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
// HTTP OWS (RFC 9110): space (0x20) and horizontal tab (0x09) only; rejects NBSP, newlines, empty or duplicate params.
const EXACT_JSON_CT = /^[ \t]*application\/json(?:[ \t]*;[ \t]*charset=utf-8)?[ \t]*$/i;
const isExactJsonContentType = (ct: string | null) => ct !== null && EXACT_JSON_CT.test(ct);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  if (request.headers.get("origin") !== vendorOrigin()) return json({ ok: false, code: "ERR_FORBIDDEN" }, 403);
  if (!isExactJsonContentType(request.headers.get("content-type"))) return json({ ok: false, code: "ERR_UNSUPPORTED_MEDIA_TYPE" }, 415);
  const { action } = await params;
  // Accepting a Tim Vendor invitation (DEC-036) is the one action without a session: the
  // token names the invitation; a new account for the invited email is created with the
  // IAM-1 policy and removed again when accepting is refused.
  if (action === "staff-invite-accept") {
    const raw = (await request.json().catch(() => null)) as unknown;
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
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
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, code: "ERR_INVALID_INPUT" }, 400);
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
    case "checklist-set": {
      // Konsol Vendor › Onboarding (UX-41, PR-59): one item's status, note and owner. A malformed
      // branch or owner id is refused here; the database validates the item, status and roles.
      // Absent means missing, null or ""; any other value must be a UUID (review round 1: false or 0
      // must not read as "tenant level" or "no owner").
      const absent = (v: unknown) => v === undefined || v === null || v === "";
      const branch = absent(body.branchId) ? null : uuid(body.branchId);
      const owner = absent(body.ownerId) ? null : uuid(body.ownerId);
      if ((!absent(body.branchId) && !branch) || (!absent(body.ownerId) && !owner)) return json({ ok: false, code: "ERR_INVALID_INPUT" }, 400);
      r = await setChecklistItem(db, c, uuid(body.tenantId), { branchId: branch, item: str(body.item, 32), status: str(body.status, 16), note: str(body.note, 500), ownerId: owner });
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
    // Konsol Vendor › Tagihan Server (UX-43; T-103; Panel 2 option A). Shape only here; the database restricts the kinds, binds the tenant
    // from the stored row, enforces requester ≠ approver and never applies a request (the executor worker does).
    case "billing-request": {
      const kind = str(body.kind, 32);
      const amount = typeof body.amountRupiah === "number" && Number.isSafeInteger(body.amountRupiah) ? body.amountRupiah : -1;
      if (kind === "server_fee_change") {
        r = await requestBilling(db, c, uuid(body.tenantId), { kind, amountRupiah: amount, effectiveMonth: str(body.effectiveMonth, 7) }, str(body.reason, 500));
      } else if (kind === "invoice_waiver") {
        r = await requestBilling(db, c, uuid(body.tenantId), { kind, invoiceId: uuid(body.invoiceId) ?? "", amountRupiah: amount }, str(body.reason, 500));
      } else {
        return json({ ok: false, code: "ERR_INVALID_INPUT" }, 400);
      }
      break;
    }
    case "billing-decide":
      if (typeof body.approve !== "boolean") return json({ ok: false, code: "ERR_INVALID_INPUT" }, 400);
      r = await decideBilling(db, c, uuid(body.requestId), body.approve, str(body.reason, 500));
      break;
    case "billing-cancel":
      r = await cancelBilling(db, c, uuid(body.requestId));
      break;
    case "billing-issue":
      r = await issueBilling(db, c, uuid(body.tenantId));
      break;
    case "billing-note":
      r = await noteAttempt(db, c, uuid(body.attemptId), str(body.evidenceRef, 120), str(body.reason, 500));
      break;
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
    case "template-save": {
      if (body.activate !== undefined && typeof body.activate !== "boolean") {
        return json({ ok: false, code: "ERR_INVALID_INPUT" }, 400);
      }
      r = await saveLegalTemplate(db, c, {
        kind: str(body.kind, 40),
        body: str(body.body, 50_000),
        activate: Boolean(body.activate),
      });
      break;
    }
    case "audit-export": {
      const absent = (v: unknown) => v === undefined || v === null || v === "";
      const tenant = absent(body.tenantId) ? null : uuid(body.tenantId);
      if (!absent(body.tenantId) && !tenant) return json({ ok: false, code: "ERR_INVALID_INPUT" }, 400);
      const from = absent(body.from) ? null : isoTimestamp(body.from);
      const to = absent(body.to) ? null : isoTimestamp(body.to);
      if ((!absent(body.from) && !from) || (!absent(body.to) && !to)) {
        return json({ ok: false, code: "ERR_INVALID_INPUT" }, 400);
      }
      if (from && to && (from.wholeSecMs > to.wholeSecMs || (from.wholeSecMs === to.wholeSecMs && from.us > to.us))) {
        return json({ ok: false, code: "ERR_INVALID_INPUT", reason: "invalid_range" }, 400);
      }
      const exp = await exportVendorActionsCsv(db, c, { tenantId: tenant, from: from?.iso ?? null, to: to?.iso ?? null });
      if (!exp.ok) {
        const status =
          exp.code === "ERR_RATE_LIMITED"
            ? 429
            : exp.code === "ERR_LIMIT_EXCEEDED"
              ? 422
              : exp.code === "ERR_NOT_FOUND"
                ? 404
                : exp.code === "ERR_FORBIDDEN"
                  ? 403
                  : 400;
        return json({ ok: false, code: exp.code, reason: exp.reason }, status);
      }
      return new NextResponse(exp.data.csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="audit-vendor.csv"',
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    default:
      return json({ ok: false, code: "ERR_NOT_FOUND" }, 404);
  }
  if (!r.ok) return json({ ok: false, code: r.code, reason: r.reason, ...("blocker" in r && r.blocker ? { blocker: r.blocker } : {}) }, r.code === "ERR_INVALID_INPUT" ? 400 : r.code === "ERR_NOT_FOUND" ? 404 : r.code === "ERR_FORBIDDEN" ? 403 : 409);
  return json({ ok: true, ...(r.data as object), r: undefined });
}
