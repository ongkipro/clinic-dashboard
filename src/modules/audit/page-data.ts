// Data access for the Log Audit page (UX-31). Server only. The session comes from the
// Better Auth cookie; the tenant and acting role are selectors (query string until the
// T-030 context switcher stores them) validated by resolveContext (TEN-1). Every gate
// of T-006 applies: no session → sign in, TOTP not enrolled → enrol, idle lock → lock.
import "server-only";
import { headers } from "next/headers";
import type pg from "pg";
import { getAuth } from "../../auth/instance";
import { openAppPool } from "../../db/rls/pool";
import type { AuditFilter } from "./audit";
import { type AuditPage, auditPageFor } from "./log-view";

let pool: Promise<pg.Pool> | undefined;
function appPool(): Promise<pg.Pool> {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL is required");
  pool ??= openAppPool({ connectionString: url, max: 5 }).catch((e) => {
    pool = undefined;
    throw e;
  });
  return pool;
}

export type { AuditPage };

export async function loadAuditPage(sel: {
  tenantId?: string;
  role?: string;
  filter: AuditFilter;
}): Promise<AuditPage> {
  const auth = await getAuth();
  const h = await headers();
  const gate = await auth.checkSession(h);
  if (gate.gate === "anonymous") return { kind: "redirect", to: "/masuk" };
  if (gate.gate === "enrol_totp") return { kind: "redirect", to: "/aktifkan-2fa" };
  if (gate.gate === "locked") return { kind: "redirect", to: "/terkunci" };
  return auditPageFor(await appPool(), gate.userId, sel);
}
