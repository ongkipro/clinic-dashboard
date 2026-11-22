// T-019 defect (t109 triage, compliance.ts register()): `valid_until` is a SQL `date`; the mapping must return that calendar day exactly,
// whatever the process timezone. node-postgres parses a `date` into a JS Date at LOCAL midnight, so `toISOString().slice(0, 10)` gives the
// previous day east of UTC (Asia/Jakarta, UTC+7). The app runs with the host's TZ (none is pinned) and CI runs in UTC, where the defect is
// invisible, so the test switches the process timezone itself (Node re-reads process.env.TZ at runtime) and reads the register under
// Asia/Jakarta, UTC and America/Los_Angeles. Synthetic data only.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { decideEvidence, register, uploadEvidence } from "../../src/modules/compliance/compliance";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let tenantId = "";
const acc: Record<"owner" | "finance", string> = { owner: "", finance: "" };
const as = async <R>(role: "owner" | "finance", fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, acc[role], { tenantId, actingRole: role }), fn);

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis Tanggal', 'emkm')`, [tenantId]);
  await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'B1', 'Asia/Jakarta')`, [tenantId]);
  for (const role of ["owner", "finance"] as const) {
    acc[role] = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.tgl@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId, accountId: acc[role], displayName: `Staf ${role}` });
    await assignRole(h.admin, { tenantId, staffId, role });
  }
});
afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("register(): valid_until is the stored calendar day under any process timezone", () => {
  it("an approved item's valid_until reads back as the stored day (not the day before), across month, year and leap-day boundaries", async () => {
    const before = process.env.TZ;
    // the register as seen by an app process in each timezone (pg parses result rows in this process, at read time)
    const readIn = async (tz: string) => {
      process.env.TZ = tz;
      try {
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone, "the runtime honours TZ").toBe(tz);
        return (await as("owner", register)).find((r) => r.obligationKey === "tax_advice")!.validUntil;
      } finally {
        if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
      }
    };
    const ZONES = ["Asia/Jakarta", "UTC", "America/Los_Angeles"];
    await as("finance", (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: Buffer.from("%PDF-1.7\nsaran pajak\n%%EOF\n"),
      expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const item = (await as("owner", register)).find((r) => r.obligationKey === "tax_advice")!;
    const file = (await h.admin.query(`select id from evidence_files where item_id = $1 order by version desc limit 1`, [item.itemId])).rows[0].id as string;
    await as("owner", (db) => decideEvidence(db, item.itemId!, file, "approved"));
    // the real approval sets valid_until from the obligation's own validity; the read must return exactly what is stored
    const stored = (await h.admin.query(`select valid_until::text d from evidence_items where id = $1`, [item.itemId])).rows[0].d as string;
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const tz of ZONES) expect(await readIn(tz), `process TZ ${tz}, stored ${stored}`).toBe(stored);
    // boundaries where a one-day shift also changes the month or the year (set as the owner of the data, guard paused by name, as the expiry test does)
    for (const day of ["2099-03-01", "2099-12-31", "2099-01-01", "2028-02-29"]) {
      await h.admin.query(`alter table evidence_items disable trigger evidence_items_guard`);
      await h.admin.query(`update evidence_items set valid_until = $2::date where id = $1`, [item.itemId, day]);
      await h.admin.query(`alter table evidence_items enable trigger evidence_items_guard`);
      expect((await h.admin.query(`select valid_until::text d from evidence_items where id = $1`, [item.itemId])).rows[0].d).toBe(day);
      for (const tz of ZONES) expect(await readIn(tz), `process TZ ${tz}, stored ${day}`).toBe(day);
    }
  });
});
