// DEL-2 cross-tenant negative cases for T-122 Ekspor Data Klinik (PR-52, UX-32):
// - route:/ekspor
// - route:/ekspor/backup
// - route:/ekspor/[id]/unduh#route
// - action:app/(app)/ekspor/actions
// - job:workers/export
// - export:modules/export/tenant.export
import type pg from "pg";
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { assignRole, createMembership } from "../../../src/modules/org/identity";
import { buildManifest, manifestJsonString, sha256, unzipStore, type ExportFile } from "../../../src/modules/export/export";
import { dbExportStore } from "../../../src/modules/export/store";
import { listTenantExports, releaseTenantExport, requestTenantExport } from "../../../src/modules/export/tenant.export";
import { defineCases, type IsolationEnv } from "../case";
import { stepUpForTests } from "../../support/step-up";

type OwnerRow = { staffId: string; accountId: string };
type Seed = { exportId: string; patientMarker: string };

const owners = new Map<string, OwnerRow>();
const seeded = new Map<string, Seed>();

async function ensureOwner(env: IsolationEnv, tenantId: string): Promise<OwnerRow> {
  const cached = owners.get(tenantId);
  if (cached) return cached;
  const existing = (
    await env.owner.query<{ staff_id: string; account_id: string }>(
      `select s.id as staff_id, m.account_id
         from staff s
         join memberships m on m.tenant_id = s.tenant_id and m.id = s.membership_id
         join staff_roles sr on sr.tenant_id = s.tenant_id and sr.staff_id = s.id and sr.role = 'owner'
        where s.tenant_id = $1 limit 1`,
      [tenantId],
    )
  ).rows[0];
  let row: OwnerRow;
  if (existing) {
    await env.owner.query(`update auth_user set two_factor_enabled = true where id = $1`, [existing.account_id]);
    row = { staffId: existing.staff_id, accountId: existing.account_id };
  } else {
    const acc = (
      await env.owner.query<{ id: string }>(
        `insert into auth_user (name, email, two_factor_enabled) values ('Owner Ekspor', $1, true) returning id`,
        [`owner-ekspor-${tenantId}@iso.test`],
      )
    ).rows[0].id;
    const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Owner Ekspor" });
    const c = await env.owner.connect();
    try {
      await assignRole(c, { tenantId, staffId, role: "owner" });
    } finally {
      c.release();
    }
    row = { staffId, accountId: acc };
  }
  owners.set(tenantId, row);
  return row;
}

async function asOwner<R>(env: IsolationEnv, tenantId: string, fn: (db: pg.ClientBase) => Promise<R>): Promise<R> {
  const own = await ensureOwner(env, tenantId);
  return withTenantContext(
    env.app,
    { tenantId, staffId: own.staffId, roles: ["owner"], allowedBranchIds: "*" },
    fn,
  );
}

async function ensureVictimExport(env: IsolationEnv): Promise<Seed> {
  const existing = seeded.get(env.victim.tenantId);
  if (existing) return existing;

  const own = await ensureOwner(env, env.victim.tenantId);
  const marker = `EKSPOR-VICTIM-${env.victim.tenantId}`;
  env.victimSecret(marker);
  await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-990122', $2, '1991-01-01', 'female', 'newborn_via_guardian', 'Sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier')
     on conflict (tenant_id, mrn) do nothing`,
    [env.victim.tenantId, marker, env.victim.branchId, own.staffId],
  );

  const req = await asOwner(env, env.victim.tenantId, (db) =>
    requestTenantExport(db, `iso-ekspor-${env.victim.tenantId}`, stepUpForTests()),
  );
  env.victimSecret(req.id);
  // Build the victim export through the real unbound clinic_app worker SQL definers
  // (export_claim -> export_put_file -> export_finish) so shared isolation fixtures from
  // unrelated suites that seed dummy non-AEAD identity_enc placeholders do not collide with
  // production's fail-closed decryption (full AEAD worker E2E is proven in tests/export/).
  const wc = await env.app.connect();
  try {
    let claimed: { id: string; tenant_id: string; generation: number } | null = null;
    for (let i = 0; i < 8; i++) {
      const r = (await wc.query<{ r: { id: string; tenant_id: string; generation: number } | null }>(`select public.export_claim(300) as r`)).rows[0]?.r ?? null;
      if (!r) break;
      const files: ExportFile[] = [
        {
          path: "csv/pasien.csv",
          kind: "csv",
          bytes: new TextEncoder().encode(`id,full_name\r\n1,${r.id === req.id ? marker : "other"}\r\n`),
        },
      ];
      for (const f of files) {
        await dbExportStore.put(wc, { exportId: r.id, generation: r.generation, path: f.path, kind: f.kind, bytes: f.bytes });
      }
      const completedAt = (await wc.query<{ now: Date }>(`select clock_timestamp() as now`)).rows[0].now;
      const m = buildManifest({ tenantId: r.tenant_id, exportId: r.id, generation: r.generation, completedAt, files });
      const mJson = manifestJsonString(m);
      await wc.query(`select public.export_finish($1, $2, $3, $4, $5)`, [r.id, r.generation, completedAt, mJson, sha256(mJson)]);
      if (r.id === req.id) {
        claimed = r;
        break;
      }
    }
    if (!claimed) throw new Error(`ensureVictimExport: failed to claim victim export ${req.id}`);
  } finally {
    wc.release();
  }
  const s: Seed = { exportId: req.id, patientMarker: marker };
  seeded.set(env.victim.tenantId, s);
  return s;
}

export default defineCases(
  {
    kind: "route",
    id: "/ekspor",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.exportId ?? "",
    async run(env) {
      await ensureVictimExport(env);
      const data = await asOwner(env, env.actor.tenantId, (db) => listTenantExports(db));
      return { status: 200, body: data };
    },
  },
  {
    kind: "route",
    id: "/ekspor/backup",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.exportId ?? "",
    async run(env) {
      await ensureVictimExport(env);
      const data = await asOwner(env, env.actor.tenantId, (db) => listTenantExports(db));
      return { status: 200, body: { status: "not_measured", ownJobs: data.jobs.map((j) => j.id) } };
    },
  },
  {
    kind: "route",
    id: "/ekspor/[id]/unduh#route",
    expect: "not-found",
    marker: (env) => seeded.get(env.victim.tenantId)?.patientMarker ?? "",
    async run(env) {
      const v = await ensureVictimExport(env);
      const own = await ensureOwner(env, env.actor.tenantId);
      try {
        const res = await releaseTenantExport(
          env.app,
          { tenantId: env.actor.tenantId, staffId: own.staffId, roles: ["owner"], allowedBranchIds: "*" },
          v.exportId,
          stepUpForTests(),
        );
        const text = [...unzipStore(res.zip).values()].map((b) => Buffer.from(b).toString("utf8")).join("\n");
        return { status: 200, body: { manifest: res.manifestSha256, text } };
      } catch (e) {
        if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { status: 404, body: null };
        throw e;
      }
    },
  },
  {
    kind: "action",
    id: "app/(app)/ekspor/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.exportId ?? "",
    async run(env) {
      const v = await ensureVictimExport(env);
      const sameKey = `iso-ekspor-${env.victim.tenantId}`;
      const res = await asOwner(env, env.actor.tenantId, (db) => requestTenantExport(db, sameKey, stepUpForTests()));
      // Replaying victim's key as victim returns victim's export id ("done"); as actor creates a separate actor export (never touching victim!).
      const replayAttempt = res.id === v.exportId ? "done" : "ERR_ISOLATED";
      return { attempts: { replayVictimKey: replayAttempt }, body: { id: res.id, replayed: res.replayed } };
    },
  },
  {
    kind: "job",
    id: "workers/export",
    marker: (env) => seeded.get(env.victim.tenantId)?.patientMarker ?? "",
    async run(env) {
      const v = await ensureVictimExport(env);
      const own = await ensureOwner(env, env.actor.tenantId);
      // Try releasing victim's worker-built archive as actor: succeeds ONLY when actor === victim.
      try {
        const out = await releaseTenantExport(
          env.app,
          { tenantId: env.actor.tenantId, staffId: own.staffId, roles: ["owner"], allowedBranchIds: "*" },
          v.exportId,
          stepUpForTests(),
        );
        const text = [...unzipStore(out.zip).values()].map((b) => Buffer.from(b).toString("utf8")).join("\n");
        return { attempts: { readBuiltExport: "done" }, body: { exportId: v.exportId, text } };
      } catch (e) {
        if (e instanceof CommandError) return { attempts: { readBuiltExport: e.code }, body: null };
        throw e;
      }
    },
  },
  {
    kind: "export",
    id: "modules/export/tenant.export",
    marker: (env) => seeded.get(env.victim.tenantId)?.patientMarker ?? "",
    async run(env) {
      const v = await ensureVictimExport(env);
      const own = await ensureOwner(env, env.actor.tenantId);
      try {
        const out = await releaseTenantExport(
          env.app,
          { tenantId: env.actor.tenantId, staffId: own.staffId, roles: ["owner"], allowedBranchIds: "*" },
          v.exportId,
          stepUpForTests(),
        );
        const text = [...unzipStore(out.zip).values()].map((b) => Buffer.from(b).toString("utf8")).join("\n");
        return { attempts: { releaseExport: "done" }, body: { text } };
      } catch (e) {
        if (e instanceof CommandError) return { attempts: { releaseExport: e.code }, body: null };
        throw e;
      }
    },
  },
);
