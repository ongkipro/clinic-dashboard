// Pengguna & Akses (PR-91, IAM-13, IAM-16, UX-3 ▸ Akses). Server code over the staff
// access functions (migration 0026); runs on the caller's client inside withTenantContext.
import type pg from "pg";
import { ROLES, type Role } from "../../../auth/policy";
import { CommandError, type ErrorCode } from "../../../lib/command";
import type { Matrix } from "../roles/matrix";
// The 07 matrix parsed at build time (tests/org/access.test.ts keeps it equal to the
// spec), so the running image needs no spec files.
import MATRIX from "./matrix.generated.json";

const CODE = /^(ERR_[A-Z_]+):/;
const KNOWN = new Set<string>(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_VERSION_CONFLICT", "ERR_IDEMPOTENCY_CONFLICT"]);

export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new CommandError(m[1] as ErrorCode);
    throw e;
  }
}

export type StaffSession = { sessionId: string; userAgent: string | null; createdAt: Date; lastActiveAt: Date; revoked: boolean };

export async function staffSessions(db: pg.ClientBase, staffId: string): Promise<StaffSession[]> {
  return call(async () =>
    (await db.query(`select * from staff_sessions($1)`, [staffId])).rows.map((r) => ({
      sessionId: r.session_id, userAgent: r.user_agent, createdAt: r.created_at, lastActiveAt: r.last_active_at, revoked: r.revoked,
    })),
  );
}

// Cabut Sesi: one session (sessionId) or every session of that staff member's membership.
export async function revokeSession(db: pg.ClientBase, staffId: string, sessionId: string | null): Promise<void> {
  await call(() => db.query(`select staff_session_revoke($1, $2)`, [staffId, sessionId]));
}

export async function endMembership(db: pg.ClientBase, staffId: string): Promise<void> {
  await call(() => db.query(`select staff_end_membership($1)`, [staffId]));
}

export async function removeRole(db: pg.ClientBase, staffId: string, role: Role): Promise<void> {
  await call(() => db.query(`select staff_role_remove($1, $2)`, [staffId, role]));
}

export async function setBranch(db: pg.ClientBase, staffId: string, role: Role, branchId: string, assigned: boolean): Promise<void> {
  await call(() => db.query(`select staff_branch_set($1, $2, $3, $4)`, [staffId, role, branchId, assigned]));
}

export type Duty = "data_protection" | "it_admin";
export const DUTY_LABEL: Record<Duty, string> = { data_protection: "Pelindungan data", it_admin: "Admin IT" };

export async function setDuty(db: pg.ClientBase, staffId: string, duty: Duty, assigned: boolean): Promise<void> {
  await call(() => db.query(`select staff_duty_set($1, $2, $3)`, [staffId, duty, assigned]));
}

export async function duties(db: pg.ClientBase): Promise<{ staffId: string; duty: Duty; assignedAt: Date }[]> {
  return (await db.query(`select staff_id, duty, assigned_at from staff_duties where ended_at is null order by assigned_at`)).rows.map((r) => ({
    staffId: r.staff_id, duty: r.duty, assignedAt: r.assigned_at,
  }));
}

// Log perubahan akses: the audit trail filtered to access changes (who, acting role, what, when).
export const ACCESS_REASONS: Record<string, string> = {
  role_assigned: "Peran ditambahkan",
  role_grant_requested: "Peran diajukan ke Owner",
  role_grant_approved: "Peran disetujui Owner",
  role_grant_rejected: "Peran ditolak Owner",
  role_removed: "Peran dicabut",
  branch_assigned: "Cabang ditambahkan",
  branch_removed: "Cabang dicabut",
  session_revoked: "Sesi dicabut",
  membership_ended: "Keanggotaan diakhiri",
  duty_assigned: "Tugas diberikan",
  duty_removed: "Tugas diakhiri",
  invitation_created: "Undangan dibuat",
  invitation_cancelled: "Undangan dibatalkan",
  invitation_accepted: "Undangan diterima",
};

export type AccessChange = {
  at: Date;
  reason: string;
  label: string;
  actingRole: string | null;
  staffId: string | null; // who made the change
  objectKind: string;
  objectId: string | null;
  targetStaffId: string | null; // whose access changed, when the object names one
  role: string | null; // the role removed (role_removed, branch_removed)
  branchId: string | null; // the branch removed (branch_removed)
};

// Readable by the log readers of audit_events (T-008/T-029); owners see the tenant. A
// revocation row names the membership and the removed role/branch; the duty and branch
// rows name their staff member, so each entry says whose access changed and how.
export async function accessLog(db: pg.ClientBase, limit = 100): Promise<AccessChange[]> {
  const { rows } = await db.query(
    `select e.at, e.reason_code, e.acting_role, e.staff_id, e.object_kind, e.object_id, r.role, r.branch_id,
            coalesce(rs.id, d.staff_id, b.staff_id, i.accepted_staff_id) as target_staff_id
       from audit_events e
       left join membership_revocations r on e.object_kind = 'membership_revocation' and r.id = e.object_id
       left join staff rs on rs.tenant_id = r.tenant_id and rs.membership_id = r.membership_id
       left join staff_duties d on e.object_kind = 'staff_duty' and d.id = e.object_id
       left join staff_branches b on e.object_kind = 'staff_branch' and b.id = e.object_id
       left join staff_invitations i on e.object_kind = 'staff_invitation' and i.id = e.object_id
      where e.reason_code = any($1::text[]) order by e.seq desc limit $2`,
    [Object.keys(ACCESS_REASONS), Math.min(limit, 500)],
  );
  return rows.map((r) => ({
    at: r.at, reason: r.reason_code, label: ACCESS_REASONS[r.reason_code], actingRole: r.acting_role, staffId: r.staff_id,
    objectKind: r.object_kind, objectId: r.object_id, targetStaffId: r.target_staff_id, role: r.role, branchId: r.branch_id,
  }));
}

// Indonesian row labels for the 07 capabilities (the spec rows are English).
export const CAPABILITY_LABEL: Record<string, string> = {
  "Staff & invitations": "Staf & undangan",
  "Catalog & branch prices": "Katalog & harga cabang",
  "Patient identity": "Identitas pasien",
  "Booking & schedule": "Booking & jadwal",
  "Staff schedules": "Jadwal staf",
  "Intake / observasi kulit": "Intake / observasi kulit",
  "Plan options & prices (no assessment, diagnosis, dose or rationale)": "Opsi rencana & harga (tanpa asesmen, diagnosis, dosis, atau alasan klinis)",
  "Examination, plan, sign": "Pemeriksaan, rencana, tanda tangan",
  "Clinical requests decide": "Keputusan permintaan klinis",
  "Complaint tasks": "Tugas keluhan",
  "Treatment checklist": "Checklist tindakan",
  "Prescribe / dispense": "Resep / penyerahan obat",
  "Stock & purchasing": "Stok & pembelian",
  "Cashier & receipts": "Kasir & kuitansi",
  "Cash refund approval": "Persetujuan refund tunai",
  "Write-off approval": "Persetujuan penghapusan piutang",
  "Late record correction approval": "Persetujuan koreksi catatan terlambat",
  "Commission rules & batches": "Aturan & batch komisi",
  "Own commission & target": "Komisi & target sendiri",
  "WhatsApp inbox": "Kotak masuk WhatsApp",
  "Dashboards": "Dashboard",
  "Ledger, periods, exports": "Buku besar, periode, ekspor",
  "Audit log, data requests": "Log audit, permintaan data",
  "Tenant data export": "Ekspor data klinik",
  "SATUSEHAT monitor": "Monitor SATUSEHAT",
  "Public site & promos": "Situs publik & promo",
  "Templates & reminder rules": "Templat & aturan pengingat",
  "Manual discount above limit (approve)": "Diskon manual di atas batas (persetujuan)",
  "Server-fee invoices (view, pay)": "Tagihan biaya server (lihat, bayar)",
  "Vendor access (Akses Vendor)": "Akses Vendor",
  "Compliance register (PR-97)": "Register kepatuhan",
};

// Matriks hak akses (read-only, 07).
export function permissionMatrix(): { capabilities: string[]; roles: Role[]; cells: Matrix } {
  const cells = MATRIX as Matrix;
  return { capabilities: Object.keys(cells), roles: [...ROLES], cells };
}
