// T-129 + HYG-024 (PR-87, 19 §3, TEN-17): DEL-2 cross-tenant isolation cases for
// /vendor/integrasi, /vendor/audit, and modules/vendor/console/audit.export.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { VENDOR_GROUP_ROLE } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { exportVendorActionsCsv } from "../../../src/modules/vendor/console/audit.export";
import { listVendorActions, readIntegrations } from "../../../src/modules/vendor/console/console";
import { defineCases, type IsolationEnv, type Json } from "../case";

const IP = "203.0.113.55";

type VendorCtx = {
  db: pg.Pool;
  supTok: string;
  audTok: string;
};

async function withVendorCtx<T>(env: IsolationEnv, fn: (vc: VendorCtx) => Promise<T>): Promise<T> {
  const suffix = randomBytes(6).toString("hex");
  const roleName = `iso_vendor_${suffix}`;
  const ownerUrl = new URL(process.env.TEST_DATABASE_URL ?? (env.owner.options.connectionString as string));
  let db: pg.Pool | null = null;
  const c = await env.owner.connect();
  let supTok = "";
  let audTok = "";
  try {
    const dbName = (await c.query(`select current_database() as d`)).rows[0].d as string;
    await c.query(`create role ${roleName} login password 'test' in role ${VENDOR_GROUP_ROLE}`);
    await c.query(`grant connect on database "${dbName}" to ${roleName}`);
    const supAcc = (
      await c.query(`insert into auth_user (name, email, two_factor_enabled) values ('SUP', $1, true) returning id`, [
        `iso.sup.${suffix}@vendor-sintetis.test`,
      ])
    ).rows[0].id as string;
    const audAcc = (
      await c.query(`insert into auth_user (name, email, two_factor_enabled) values ('AUD', $1, true) returning id`, [
        `iso.aud.${suffix}@vendor-sintetis.test`,
      ])
    ).rows[0].id as string;
    await c.query(`insert into vendor_ip_allowlist (cidr, label) values ('203.0.113.0/24', 'ISO') on conflict do nothing`);
    const supStaff = (
      await c.query(`insert into vendor_staff (account_id, display_name, state) values ($1, 'ISO Dukungan', 'active') returning id`, [supAcc])
    ).rows[0].id as string;
    const audStaff = (
      await c.query(`insert into vendor_staff (account_id, display_name, state) values ($1, 'ISO Auditor', 'active') returning id`, [audAcc])
    ).rows[0].id as string;
    await c.query(`insert into vendor_staff_roles (staff_id, role) values ($1, 'support'), ($2, 'vendor_auditor')`, [supStaff, audStaff]);
    supTok = `isosup${randomBytes(12).toString("hex")}`;
    audTok = `isoaud${randomBytes(12).toString("hex")}`;
    await c.query(
      `insert into auth_session (user_id, token, expires_at, surface, second_factor_at)
       values ($1, $2, now() + interval '8 hours', 'vendor', now()),
              ($3, $4, now() + interval '8 hours', 'vendor', now())`,
      [supAcc, supTok, audAcc, audTok],
    );
    const u = new URL(ownerUrl.toString());
    u.username = roleName;
    u.password = "test";
    u.pathname = `/${dbName}`;
    db = await openAppPool({ connectionString: u.toString(), max: 1 }, VENDOR_GROUP_ROLE);
  } finally {
    c.release();
  }
  try {
    return await fn({ db, supTok, audTok });
  } finally {
    await db.end().catch(() => {});
    const c2 = await env.owner.connect();
    try {
      const dbName = (await c2.query(`select current_database() as d`)).rows[0].d as string;
      await c2.query(`revoke connect on database "${dbName}" from ${roleName}`).catch(() => {});
      await c2.query(`drop role if exists ${roleName}`).catch(() => {});
    } finally {
      c2.release();
    }
  }
}

const seededAudit = new WeakSet<object>();
async function seedVictimAction(env: IsolationEnv): Promise<void> {
  if (seededAudit.has(env.victim)) return;
  seededAudit.add(env.victim);
  await env.owner.query(
    `insert into vendor_actions (acting_role, action, tenant_id, outcome, reason_code, client_ip)
     values ('platform_owner', 'tenant_review', $1, 'success', 'checked', '203.0.113.88')`,
    [env.victim.tenantId],
  );
  await env.owner.query(
    `insert into payment_webhook_events (tenant_id, provider, provider_account, environment, provider_event_id, order_ref, signature_ok, timestamp_ok, outcome, body_sha256, received_at)
     values ($1, 'mock', 'iso-acct', 'local', $2, 'ISO-ORD', false, true, 'rejected_signature', repeat('c', 64), clock_timestamp())`,
    [env.victim.tenantId, `iso-evt-${randomBytes(6).toString("hex")}`],
  );
}

export default defineCases(
  {
    kind: "route",
    id: "/vendor/integrasi",
    expect: "filtered",
    marker: (env) => env.victim.legalName,
    async run(env) {
      await seedVictimAction(env);
      return withVendorCtx(env, async (vc) => {
        // clinic_app must never have EXECUTE on vendor_console_integrations
        await env.app.query(`select vendor_console_integrations($1, $2, $3::uuid)`, [vc.supTok, IP, env.victim.tenantId]).then(
          () => {
            throw new Error("clinic_app unexpectedly executed vendor_console_integrations");
          },
          (e: { code?: string }) => {
            if (e.code !== "42501") throw e;
          },
        );
        const r = await readIntegrations(vc.db, { token: vc.supTok, ip: IP }, env.actor.tenantId);
        if (!r.ok) return { status: 403, body: JSON.parse(JSON.stringify(r)) as Json };
        return { status: 200, body: JSON.parse(JSON.stringify(r.data)) as Json };
      });
    },
  },
  {
    kind: "route",
    id: "/vendor/audit",
    expect: "filtered",
    marker: (env) => env.victim.legalName,
    async run(env) {
      await seedVictimAction(env);
      return withVendorCtx(env, async (vc) => {
        const r = await listVendorActions(vc.db, { token: vc.audTok, ip: IP }, { tenantId: env.actor.tenantId, limit: 50 });
        if (!r.ok) return { status: 403, body: JSON.parse(JSON.stringify(r)) as Json };
        return { status: 200, body: JSON.parse(JSON.stringify(r.data)) as Json };
      });
    },
  },
  {
    kind: "export",
    id: "modules/vendor/console/audit.export",
    marker: (env) => env.victim.legalName,
    async run(env) {
      await seedVictimAction(env);
      return withVendorCtx(env, async (vc) => {
        // Verify clinic_app cannot invoke vendor_console_actions_export
        await env.app.query(`select vendor_console_actions_export($1, $2, $3::uuid, null, null)`, [vc.audTok, IP, env.victim.tenantId]).then(
          () => {
            throw new Error("clinic_app unexpectedly executed vendor_console_actions_export");
          },
          (e: { code?: string }) => {
            if (e.code !== "42501") throw e;
          },
        );
        const r = await exportVendorActionsCsv(vc.db, { token: vc.audTok, ip: IP }, { tenantId: env.actor.tenantId });
        if (!r.ok) {
          return {
            attempts: { victim_row_in_actor_export: r.reason },
            body: JSON.parse(JSON.stringify(r)) as Json,
          };
        }
        const includesVictim = r.data.rows.some((row) => row.tenantId === env.victim.tenantId);
        return {
          attempts: { victim_row_in_actor_export: includesVictim ? "done" : "not_seen" },
          body: { csv: r.data.csv, count: r.data.count } as Json,
        };
      });
    },
  },
);
