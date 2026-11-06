// HYG-008b: every vendor console entry point re-reads its caller's authority after its last
// wait (vendor_authority_recheck). A refusal there raises 42501 "vendor_authority: <reason>",
// which rolls the whole statement back, effect included. This turns it into the console's usual
// answer and records it in its own transaction (SEC-16: every refusal is logged), as
// vendor_request_consume_refused does for workers.
import type pg from "pg";

export type ConsoleRefusal = { ok: false; code: "ERR_FORBIDDEN"; reason: string };

// What the refused call was about: the database resolves the tenant (a tenant id, or the tenant
// of a support session / owner invitation) and records the object. Only ids, never free text.
export type RefusalSubject =
  | { tenant: string | null; object?: string | null }
  | { supportSession: string | null }
  | { ownerInvitation: string | null }
  | { object: string | null };

const REFUSED = /^ERR_FORBIDDEN: vendor_authority: ([a-z_]+)$/;

export async function withAuthorityRecheck<R>(
  db: pg.Pool | pg.ClientBase,
  c: { token: string; ip: string },
  fn: string,
  subject: RefusalSubject,
  run: () => Promise<R>,
): Promise<R | ConsoleRefusal> {
  try {
    return await run();
  } catch (e) {
    const m = (e as { code?: string; message?: string }).code === "42501" ? REFUSED.exec((e as Error).message) : null;
    if (!m) throw e;
    const kind = "tenant" in subject ? "tenant" : "supportSession" in subject ? "support_session" : "ownerInvitation" in subject ? "owner_invitation" : "object";
    const id = "tenant" in subject ? subject.tenant : "supportSession" in subject ? subject.supportSession : "ownerInvitation" in subject ? subject.ownerInvitation : subject.object;
    const object = "tenant" in subject ? (subject.object ?? null) : null;
    await db.query(`select vendor_authority_refused($1, $2, $3, $4, $5, $6, $7)`, [c.token, c.ip, fn, kind, id, object, m[1]]);
    return { ok: false, code: "ERR_FORBIDDEN", reason: m[1] };
  }
}
