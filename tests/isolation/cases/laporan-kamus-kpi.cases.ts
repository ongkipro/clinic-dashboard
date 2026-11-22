// Laporan › Kamus KPI (UX-59, PR-95; T-116): the DEL-2 case for the route /laporan/kamus-kpi (auto-discovered by tests/isolation/isolation.test.ts; the route id is the page's path without the
// (app) group; no tests/isolation/surfaces.ts change).
//
// WHAT THIS CASE PROVES, AND WHAT IT DOES NOT. The dictionary is STATIC: K1–K27 definitions from src/modules/reporting/reports/dictionary.ts, rendered by KamusKpiView with no database read and
// no tenant context. So there is no tenant data on this surface to leak, and this case does not pretend otherwise. The harness asks every case for a positive control (as tenant B, the body must
// carry a B-specific marker) and then registers that marker as a secret for the negative run (as tenant A). A static page's markup is identical for both tenants, so a marker taken from the page
// itself would be present in both runs and the gate could never pass; the marker therefore comes from the one place that IS tenant data and that a request has: the caller's OWN tenant row, read
// through the caller's tenant context (RLS gives each tenant its own row only). The body is:
//   - `tenants`: the caller's own legal name(s) as RLS returns them — as B it carries B's name (the positive control: the case is bound to the caller), as A it carries A's name and nothing of B;
//   - `entries` and `html`: the static dictionary, exactly what the VIEW renders. The harness checks the whole body for B's tenant id, branch id, legal name and marker, and the case throws if the
//     markup differs between the two runs (the view cannot depend on a tenant, because it receives none).
// LIMIT, stated plainly: the case calls KamusKpiView directly; it does NOT run the route's role gate or loader, so it cannot catch a future change that makes the ROUTE read tenant data through
// them. That property — the route's body reads no database — is what tests/reporting/reports.test.ts proves instead: kamusBody runs there with NO pool at all (gate.pool = null), so any database
// read would throw.
// It is a case, not a surfaces.ts exemption, because the exemption list lives in tests/isolation/surfaces.ts, which T-116 may not edit.
// route kind "filtered": the page has no by-id selector, so it answers 200 for both tenants with the same dictionary (no not-found expectation).
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { KamusKpiView } from "../../../src/app/(app)/laporan/kamus-kpi/view";
import { withTenantContext } from "../../../src/db/rls/context";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { DICTIONARY } from "../../../src/modules/reporting/reports/dictionary";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const accOf = new Map<string, string>();
// The tenant's owner (any role of the dictionary's nav row would do: the page takes no tenant input), bound to its tenant context as a request would be.
async function owner(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = accOf.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`owner.kamus116.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Pemilik Kamus" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  accOf.set(tenantId, acc);
  return acc;
}
async function asOwner<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const ctx = await resolveContext(env.app, await owner(env, tenantId), { tenantId, actingRole: "owner" });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

// the markup of the dictionary as rendered for the first caller; the second caller (the other tenant) must get the same bytes
let firstMarkup: string | null = null;
// the positive control must find B's own legal name in the body: the caller's own tenant row, read under the caller's context
const marker = (env: IsolationEnv) => env.victim.legalName;

export default defineCases({
  kind: "route",
  id: "/laporan/kamus-kpi",
  expect: "filtered",
  marker,
  async run(env) {
    const tenants = await asOwner(env, env.actor.tenantId, async (db) =>
      ((await (db as { query(sql: string): Promise<{ rows: { legal_name: string }[] }> }).query(`select legal_name from tenants order by legal_name`)).rows.map((r) => r.legal_name)));
    // the page body for the CALLER: the same view and dictionary the route renders (it takes no tenant input at all)
    const html = renderToStaticMarkup(KamusKpiView({ state: { kind: "ok" } }));
    const sha = createHash("sha256").update(html).digest("hex");
    if (firstMarkup === null) firstMarkup = sha;
    else if (firstMarkup !== sha) throw new Error("isolation case: the static dictionary rendered differently for two tenants — it must not depend on a tenant");
    return { status: 200, body: { tenants, entries: DICTIONARY.map((k) => k.id), html } };
  },
});
