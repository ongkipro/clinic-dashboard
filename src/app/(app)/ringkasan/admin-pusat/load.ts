// Ringkasan Admin Pusat (UX-57, PR-33g; T-115): the page-data core. It reads the setup state through EXISTING readers only, under RLS as the caller (no reporting
// reader, no financial or clinical table): branches / hours / rooms / branch_services (tenant-wide), catalog_commercial() (active versions only; prices never
// read), listStaff + listCredentials, staff_invitations (owner / admin_pusat), role_requests, and approvals the caller requested itself (RLS: requested_by).
// No `server-only`: data.ts gates the role (Admin Pusat only) before the tenant transaction; this core is what the tests run on PostgreSQL.
import type pg from "pg";
import { APPROVAL_TYPES } from "../../../../modules/approvals/inbox";
import { commercialCatalog } from "../../../../modules/catalog/catalog";
import { licenceComplete, listBranches } from "../../../../modules/org/branches/branches";
import { listCredentials } from "../../../../modules/org/licences/licences";
import { listStaff } from "../../../../modules/org/staff/staff";
import { type AdminHomeData, assemble, localDate, type Raw, waitingFor } from "./model";

const countBy = (rows: { branch_id: string; n: string | number }[]) => Object.fromEntries(rows.map((r) => [r.branch_id, Number(r.n)]));

export async function readAdminHome(db: pg.ClientBase, now: Date = new Date()): Promise<AdminHomeData> {
  const branches = await listBranches(db);
  const hours = (await db.query(`select branch_id, count(*) as n from branch_hours group by branch_id`)).rows;
  const rooms = (await db.query(`select branch_id, count(*) as n from rooms where is_active group by branch_id`)).rows;
  const services = (await db.query(`select branch_id, array_agg(item_id) as ids from branch_services group by branch_id`)).rows;
  const catalog = await commercialCatalog(db);
  const staff = await listStaff(db);
  const credentials = await listCredentials(db);
  const invitations = (await db.query(`select count(*) as n from staff_invitations where state = 'pending' and expires_at > now()`)).rows[0].n;
  const approvals = (await db.query(`select id, type from approvals where state = 'pending' and requested_by = app_staff_id() order by requested_at`)).rows;
  const roleRequests = (await db.query(
    `select r.id, s.display_name, r.role, r.change, r.state from role_requests r join staff s on s.tenant_id = r.tenant_id and s.id = r.staff_id
      where r.state in ('pending', 'awaiting_confirmation') order by r.created_at`,
  )).rows;
  const raw: Raw = {
    branches: branches.map((b) => ({
      id: b.id, code: b.code, name: b.name, timezone: b.timezone, licenceComplete: licenceComplete(b),
      published: !!b.publishFrom && b.publishFrom <= now && (!b.publishUntil || b.publishUntil > now),
    })),
    hours: countBy(hours), rooms: countBy(rooms),
    services: Object.fromEntries(services.map((r) => [r.branch_id as string, r.ids as string[]])),
    activeServiceIds: catalog.filter((c) => c.kind === "service").map((c) => c.itemId),
    staff: staff.map((s) => ({ staffId: s.staffId, name: s.name, active: s.active, roles: s.roles })),
    credentials: credentials.map((c) => ({ staffId: c.staffId, state: c.state, kind: c.kind, profession: c.profession, validFrom: c.validFrom, expiresOn: c.expiresOn, superseded: c.superseded })),
    invitationsPending: Number(invitations),
    approvalsPending: approvals.map((a) => ({ id: a.id, type: a.type, typeLabel: APPROVAL_TYPES[a.type]?.label ?? a.type, waitingFor: waitingFor(APPROVAL_TYPES[a.type]?.approverRoles ?? []) })),
    roleRequestsPending: roleRequests.map((r) => ({ id: r.id, staffName: r.display_name, role: r.role, change: r.change, state: r.state })),
    today: Object.fromEntries(branches.map((b) => [b.id, localDate(b.timezone, now)])),
  };
  return assemble(raw);
}
