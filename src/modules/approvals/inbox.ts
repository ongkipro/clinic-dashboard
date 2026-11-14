// Persetujuan inbox (PR-44, UX-26): one list of every waiting approval the acting role
// may read (approvals_read RLS), filtered by type, and the detail with requester, reason
// and impact. Deciding goes through decideApproval (T-011), which enforces the rules;
// `blocked` only decides which buttons the screen offers.
import type pg from "pg";
import type { Role } from "../../auth/policy";
import type { Approval } from "./approvals";

// Mirror of the approval_types registry (platform table; clinic_app has no grant on it).
// tests/approvals/inbox.test.ts keeps it equal to the database rows; a task that adds a
// type adds it to the migration and here.
export const APPROVAL_TYPES: Record<string, { label: string; approverRoles: readonly Role[] }> = {
  refund_exception: { label: "Refund tunai", approverRoles: ["owner", "manager"] }, // a manager only where SET-11 allows (T-078)
  write_off: { label: "Hapus piutang", approverRoles: ["owner"] },
  attribution_correction: { label: "Koreksi atribusi staf", approverRoles: ["owner", "manager"] },
  commission_batch: { label: "Batch komisi", approverRoles: ["owner"] },
  stock_adjustment: { label: "Penyesuaian stok", approverRoles: ["owner", "manager"] },
  disposal: { label: "Pemusnahan", approverRoles: ["owner", "manager"] },
  setting_change_owner: { label: "Perubahan pengaturan", approverRoles: ["owner"] },
  // The owner decides clinical drafts only while the tenant has no facility head (DEC-031 D2).
  setting_change_fh: { label: "Perubahan pengaturan klinis", approverRoles: ["facility_head", "owner"] },
  // T-033 (DEC-046): a clinical catalog change; any facility head of the tenant, the owner only as fallback.
  catalog_clinical_review: { label: "Review klinis katalog", approverRoles: ["facility_head", "owner"] },
  // T-034 (DEC-047 (2)): a BHP recipe change; any pharmacist of the tenant, the facility head or the
  // owner only while no pharmacist other than the requester could.
  catalog_materials_review: { label: "Review bahan (BHP) katalog", approverRoles: ["pharmacist", "facility_head", "owner"] },
  // T-053 (PR-13): a correction of a signed record more than 48 h after signing; never the requesting doctor.
  record_late_correction: { label: "Koreksi rekam medis", approverRoles: ["records_officer", "facility_head"] },
  // T-072 (PR-19, SET-43): a manager decides on the invoice's issue day (when SET-43 allows), afterwards the owner.
  invoice_void: { label: "Void invoice", approverRoles: ["owner", "manager"] },
  // T-080 (PR-72, SET-12): a manager decides only within the manager limit, otherwise the owner.
  manual_discount: { label: "Diskon manual", approverRoles: ["owner", "manager"] },
};
// Types the owner decides only while no facility head other than the requester could (DEC-031 D2,
// DEC-046 (1)).
const OWNER_FALLBACK_TYPES = ["setting_change_fh", "catalog_clinical_review"];

// Approval types whose decision also applies a waiting draft (settings, T-017): the
// detail decides them through their module so both happen in one transaction.
export const SETTING_DRAFT_TYPES = new Set(["setting_change_owner", "setting_change_fh"]);

// Integer rupiah as shown on screen (Rp1.250.000).
export const rupiah = (n: number) => `Rp${new Intl.NumberFormat("id-ID").format(n)}`;

// 19 §2.14: who opens Persetujuan. A requester outside these roles reads its own
// requests through RLS but has no inbox screen.
export const INBOX_READERS: readonly Role[] = ["owner", "manager", "facility_head", "records_officer", "pharmacist"];

export type InboxRow = {
  id: string;
  type: string;
  typeLabel: string;
  state: Approval["state"];
  requestedAt: Date;
  requesterName: string | null; // null when the acting role may not read staff names (records officer)
  requestedAs: Role;
  reason: string | null;
  amountRupiah: number | null;
  branchName: string | null;
  subjectKind: string;
};

export type InboxDetail = InboxRow & {
  decidedAt: Date | null;
  deciderName: string | null;
  decidedAs: Role | null;
  decisionReason: string | null;
  ownerSelf: boolean;
  approverRoles: readonly Role[];
  // Why the screen offers no Setujui/Tolak (UX-26 copy), or null when it does.
  blocked: "own-request" | "not-approver" | "decided" | null;
};

const SELECT = `
  select a.id, a.type, a.state, a.requested_at, a.requested_as, a.request_reason, a.amount_rupiah, a.subject_kind,
         a.requested_by, a.decided_at, a.decided_as, a.decision_reason, a.owner_self,
         rs.display_name as requester_name, ds.display_name as decider_name, b.name as branch_name
    from approvals a
    left join staff rs on rs.tenant_id = a.tenant_id and rs.id = a.requested_by
    left join staff ds on ds.tenant_id = a.tenant_id and ds.id = a.decided_by
    left join branches b on b.tenant_id = a.tenant_id and b.id = a.branch_id`;

type Raw = Record<string, unknown>;
const row = (r: Raw): InboxRow => ({
  id: r.id as string,
  type: r.type as string,
  typeLabel: APPROVAL_TYPES[r.type as string]?.label ?? (r.type as string),
  state: r.state as Approval["state"],
  requestedAt: r.requested_at as Date,
  requesterName: (r.requester_name as string | null) ?? null,
  requestedAs: r.requested_as as Role,
  reason: (r.request_reason as string | null) ?? null,
  amountRupiah: r.amount_rupiah === null ? null : Number(r.amount_rupiah),
  branchName: (r.branch_name as string | null) ?? null,
  subjectKind: r.subject_kind as string,
});

// The types a role decides (UX-26 "by type"): the inbox lists only these. Facility head
// and records officer decide none of today's types (late record correction and its
// approvers arrive with the clinical-record tasks), so their inbox is empty for now.
export function decidableTypes(role: Role): string[] {
  return Object.entries(APPROVAL_TYPES).filter(([, t]) => t.approverRoles.includes(role)).map(([k]) => k);
}

export const INBOX_LIMIT = 200;

// Waiting approvals the role decides, oldest first (a queue: the longest wait on top),
// optionally of one type. An unknown or foreign type lists nothing, never an error.
// `more` says the list stopped at INBOX_LIMIT.
export async function listInbox(db: pg.ClientBase, role: Role, filter: { type?: string; limit?: number } = {}): Promise<{ rows: InboxRow[]; more: boolean }> {
  const limit = filter.limit ?? INBOX_LIMIT;
  const types = decidableTypes(role).filter((t) => !filter.type || t === filter.type);
  const { rows } = await db.query(
    `${SELECT} where a.state = 'pending' and a.type = any($1::text[])
        and ($3::text <> 'owner' or a.type <> all($4::text[]) or approval_owner_decides_fh(a.id))
        and ($3::text not in ('owner','facility_head') or a.type <> 'catalog_materials_review' or not approval_ph_available(a.id))
        and ($3::text <> 'manager' or a.type <> 'invoice_void' or approval_manager_decides_void(a.id))
        and ($3::text <> 'manager' or a.type <> 'refund_exception' or approval_manager_decides_refund(a.id))
        and ($3::text <> 'manager' or a.type <> 'manual_discount' or approval_manager_decides_discount(a.id))
      order by a.requested_at, a.id limit $2`,
    [types, limit + 1, role, OWNER_FALLBACK_TYPES],
  );
  return { rows: rows.slice(0, limit).map(row), more: rows.length > limit };
}

// One approval as the acting staff member sees it; null when it is not readable (TEN-1:
// another tenant's or another branch's approval is not found).
export async function inboxDetail(db: pg.ClientBase, actor: { staffId: string; role: Role }, id: string): Promise<InboxDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { rows } = await db.query(`${SELECT} where a.id = $1`, [id]);
  const r = rows[0];
  if (!r) return null;
  const blocked =
    r.state !== "pending" ? "decided"
    : r.requested_by === actor.staffId ? "own-request"
    : !(APPROVAL_TYPES[r.type]?.approverRoles ?? []).includes(actor.role) ? "not-approver"
    // The owner is only the fallback for clinical drafts (DEC-031 D2).
    : actor.role === "owner" && OWNER_FALLBACK_TYPES.includes(r.type) && !(await db.query(`select approval_owner_decides_fh($1) as ok`, [id])).rows[0].ok ? "not-approver"
    // DEC-047 (2): a pharmacist decides the materials review while one other than the requester could.
    : (actor.role === "owner" || actor.role === "facility_head") && r.type === "catalog_materials_review" && (await db.query(`select approval_ph_available($1) as ok`, [id])).rows[0].ok ? "not-approver"
    // SET-43 (T-072): a manager decides a void on the invoice's issue day only; afterwards it is the owner's.
    : actor.role === "manager" && r.type === "invoice_void" && !(await db.query(`select approval_manager_decides_void($1) as ok`, [id])).rows[0].ok ? "not-approver"
    // SET-11 (T-078): a manager decides a cash refund only where the tenant allows owner_manager.
    : actor.role === "manager" && r.type === "refund_exception" && !(await db.query(`select approval_manager_decides_refund($1) as ok`, [id])).rows[0].ok ? "not-approver"
    : actor.role === "manager" && r.type === "manual_discount" && !(await db.query(`select approval_manager_decides_discount($1) as ok`, [id])).rows[0].ok ? "not-approver"
    : null;
  return {
    ...row(r),
    decidedAt: (r.decided_at as Date | null) ?? null,
    deciderName: (r.decider_name as string | null) ?? null,
    decidedAs: (r.decided_as as Role | null) ?? null,
    decisionReason: (r.decision_reason as string | null) ?? null,
    ownerSelf: Boolean(r.owner_self),
    approverRoles: APPROVAL_TYPES[r.type]?.approverRoles ?? [],
    blocked,
  };
}
