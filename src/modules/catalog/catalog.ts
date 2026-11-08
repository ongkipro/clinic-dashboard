// Catalog commands and reads (PR-41, T-033; service master PR-88, T-034). Every call runs inside
// withTenantContext; the catalog_* functions (migrations 0054, 0055) enforce roles, the clinical and
// materials review gates (DEC-046, DEC-047), the legal delegation floor, the item lock while a review
// is pending, and immutability. Clinical review decisions go through the
// approvals engine (decideApproval / cancelApproval): a trigger moves the version on every path.
import type pg from "pg";
import { CommandError, type ErrorCode } from "../../lib/command";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_VERSION_CONFLICT", "ERR_INVALID_INPUT", "ERR_IDEMPOTENCY_CONFLICT"]);

// Reasons the screens word specifically.
const REASONS = new Set(["catalog_review_pending", "delegation_floor", "category_required"]);

export class CatalogError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new CatalogError(m[1] as ErrorCode, REASONS.has(m[2]) ? m[2] : undefined);
    throw e;
  }
}

export type CatalogFields = {
  name: string;
  tax_category: "exempt_medical" | "taxable_service" | "taxable_goods" | "non_object";
  tax_basis: string;
  normal_price: number;
  control_count?: number;
  control_validity_days?: number | null;
  booking_dp_enabled?: boolean;
  booking_dp_amount?: number | null;
  min_dp_pct?: number | null;
  installments_allowed?: boolean;
  validity_days?: number | null;
  material_formula?: unknown[];
  commission_scope?: string[];
  indications?: string | null;
  contraindications?: string | null;
  consent_template?: string | null;
  delegation?: string | null;
  // Service master (T-034; services only). Omitted keys carry forward from the active version.
  category?: string | null;
  prep_min?: number;
  treatment_min?: number;
  buffer_min?: number;
  online_bookable?: boolean;
  aftercare_text?: string | null;
  resources?: { kind: "room" | "device"; code: string; required?: boolean }[];
  // Exactly one of role or staff_id per row.
  eligibility?: { role?: string; staff_id?: string; mode: string }[];
};

export type Published = {
  itemId: string; versionId: string; version: number; state: "active" | "pending_review"; approvalId: string | null; materialsApprovalId: string | null;
};

// A new version of an existing item, or a new item (kind + code).
export async function publish(
  db: pg.ClientBase,
  target: { itemId: string } | { kind: "service" | "product" | "package" | "material"; code: string },
  fields: CatalogFields,
  reason: string,
): Promise<Published> {
  const r = await call(() =>
    db.query(`select catalog_publish($1, $2, $3, $4::jsonb, $5) as r`, [
      "itemId" in target ? target.itemId : null,
      "itemId" in target ? null : target.kind,
      "itemId" in target ? null : target.code,
      JSON.stringify(fields),
      reason,
    ]),
  );
  const j = r.rows[0].r;
  return { itemId: j.item_id, versionId: j.version_id, version: j.version, state: j.state, approvalId: j.approval_id, materialsApprovalId: j.materials_approval_id };
}

export type CommercialRow = {
  itemId: string; versionId: string; version: number; kind: string; code: string; name: string; taxCategory: string; taxBasis: string;
  normalPrice: number; controlCount: number; controlValidityDays: number | null; bookingDpEnabled: boolean; bookingDpAmount: number | null;
  minDpPct: number | null; installmentsAllowed: boolean; validityDays: number | null; commissionScope: string[]; pendingReview: boolean;
  category: string | null; prepMin: number | null; treatmentMin: number | null; bufferMin: number | null; onlineBookable: boolean;
};

// Active versions without clinical content, for every member (DEC-046 (2)).
export async function commercialCatalog(db: pg.ClientBase): Promise<CommercialRow[]> {
  return (await db.query(`select * from catalog_commercial()`)).rows.map((r) => ({
    itemId: r.item_id, versionId: r.version_id, version: r.version, kind: r.kind, code: r.code, name: r.name, taxCategory: r.tax_category,
    taxBasis: r.tax_basis, normalPrice: Number(r.normal_price), controlCount: r.control_count, controlValidityDays: r.control_validity_days,
    bookingDpEnabled: r.booking_dp_enabled, bookingDpAmount: r.booking_dp_amount === null ? null : Number(r.booking_dp_amount),
    minDpPct: r.min_dp_pct, installmentsAllowed: r.installments_allowed, validityDays: r.validity_days, commissionScope: r.commission_scope,
    pendingReview: r.pending_review, category: r.category, prepMin: r.prep_min, treatmentMin: r.treatment_min, bufferMin: r.buffer_min,
    onlineBookable: r.online_bookable,
  }));
}

export type VersionRow = {
  id: string; itemId: string; version: number; state: string; name: string; taxCategory: string; taxBasis: string; normalPrice: number;
  controlCount: number; controlValidityDays: number | null; bookingDpEnabled: boolean; bookingDpAmount: number | null; minDpPct: number | null;
  installmentsAllowed: boolean; validityDays: number | null; commissionScope: string[]; materialFormula: unknown[]; indications: string | null; contraindications: string | null;
  consentTemplate: string | null; delegation: string | null; reason: string; createdBy: string; createdAs: string; createdAt: Date;
  approvalId: string | null; materialsApprovalId: string | null; decidedAt: Date | null; referencedAt: Date | null;
  category: string | null; prepMin: number | null; treatmentMin: number | null; bufferMin: number | null; onlineBookable: boolean; aftercareText: string | null;
};

// Every version of an item the caller may read (RLS decides: clinical-content roles see active and
// superseded versions; editors and facility heads also see unpublished ones).
export async function itemVersions(db: pg.ClientBase, itemId: string): Promise<VersionRow[]> {
  return (await db.query(`select * from catalog_versions where item_id = $1 order by version desc`, [itemId])).rows.map((r) => ({
    id: r.id, itemId: r.item_id, version: r.version, state: r.state, name: r.name, taxCategory: r.tax_category, taxBasis: r.tax_basis,
    normalPrice: Number(r.normal_price), controlCount: r.control_count, controlValidityDays: r.control_validity_days,
    bookingDpEnabled: r.booking_dp_enabled, bookingDpAmount: r.booking_dp_amount === null ? null : Number(r.booking_dp_amount),
    minDpPct: r.min_dp_pct, installmentsAllowed: r.installments_allowed, validityDays: r.validity_days, commissionScope: r.commission_scope,
    materialFormula: r.material_formula, indications: r.indications, contraindications: r.contraindications, consentTemplate: r.consent_template, delegation: r.delegation,
    reason: r.reason, createdBy: r.created_by, createdAs: r.created_as, createdAt: r.created_at, approvalId: r.approval_id,
    materialsApprovalId: r.materials_approval_id, decidedAt: r.decided_at, referencedAt: r.referenced_at,
    category: r.category, prepMin: r.prep_min, treatmentMin: r.treatment_min, bufferMin: r.buffer_min, onlineBookable: r.online_bookable, aftercareText: r.aftercare_text,
  }));
}

export async function catalogItem(db: pg.ClientBase, itemId: string): Promise<{ id: string; kind: string; code: string } | null> {
  return (await db.query(`select id, kind, code from catalog_items where id = $1`, [itemId])).rows[0] ?? null;
}

// Later sale/booking writers mark the version they use (CLIN-011).
export async function referenceVersion(db: pg.ClientBase, versionId: string): Promise<void> {
  await call(() => db.query(`select catalog_version_reference($1)`, [versionId]));
}

// Items with no active version yet, for editors and facility heads (review round 1, P2).
export type UnpublishedRow = { itemId: string; kind: string; code: string; name: string; versionId: string; state: string };
export async function unpublishedItems(db: pg.ClientBase): Promise<UnpublishedRow[]> {
  return (await db.query(`select * from catalog_unpublished()`)).rows.map((r) => ({ itemId: r.item_id, kind: r.kind, code: r.code, name: r.name, versionId: r.version_id, state: r.state }));
}

// The catalog version a review approval decides, for the Persetujuan detail. A clinical review shows
// the proposed and active clinical fields, aftercare and eligibility (never the recipe); a materials
// review shows the proposed and active recipe (never clinical text; DEC-047 (2)). Null when the
// caller may not read it.
export type Clinical = {
  indications: string | null; contraindications: string | null; consentTemplate: string | null; delegation: string | null; aftercareText: string | null;
  eligibility: { role: string | null; staffId: string | null; staffName: string | null; mode: string }[];
};
export type ReviewTarget = {
  reviewType: "catalog_clinical_review" | "catalog_materials_review";
  itemId: string; kind: string; code: string; name: string; version: number; state: string; category: string | null;
  proposed: Clinical | null; active: Clinical | null; hasActive: boolean;
  formula: unknown[] | null; activeFormula: unknown[] | null;
};
const elig = (j: unknown) => ((j as { role: string | null; staff_id: string | null; staff_name: string | null; mode: string }[] | null) ?? [])
  .map((e) => ({ role: e.role, staffId: e.staff_id, staffName: e.staff_name, mode: e.mode }));
export async function reviewTarget(db: pg.ClientBase, approvalId: string): Promise<ReviewTarget | null> {
  const r = (await db.query(`select * from catalog_review_target($1)`, [approvalId])).rows[0];
  if (!r) return null;
  const clinical = r.review_type === "catalog_clinical_review";
  return {
    reviewType: r.review_type, itemId: r.item_id, kind: r.kind, code: r.code, name: r.name, version: r.version, state: r.state, category: r.category,
    hasActive: r.has_active,
    proposed: clinical ? { indications: r.indications, contraindications: r.contraindications, consentTemplate: r.consent_template, delegation: r.delegation, aftercareText: r.aftercare_text, eligibility: elig(r.eligibility) } : null,
    active: clinical && r.has_active ? { indications: r.active_indications, contraindications: r.active_contraindications, consentTemplate: r.active_consent_template, delegation: r.active_delegation, aftercareText: r.active_aftercare_text, eligibility: elig(r.active_eligibility) } : null,
    formula: clinical ? null : r.material_formula,
    activeFormula: clinical ? null : r.active_material_formula,
  };
}

// A version's resources and eligibility as the caller may read them (RLS: rows follow their version;
// T-034). Empty lists when the version is not readable.
export type ServiceRows = {
  resources: { kind: string; code: string; required: boolean }[];
  eligibility: { role: string | null; staffId: string | null; mode: string }[];
};
export async function serviceRows(db: pg.ClientBase, versionId: string): Promise<ServiceRows> {
  const res = await db.query(`select kind, code, required from service_resources where version_id = $1 order by kind, code`, [versionId]);
  const el = await db.query(`select role, staff_id, mode from service_staff_eligibility where version_id = $1 order by role nulls last, staff_id`, [versionId]);
  return { resources: res.rows, eligibility: el.rows.map((r) => ({ role: r.role, staffId: r.staff_id, mode: r.mode })) };
}

// The active version's requirements for the booking and catalog roles (DEC-047 (4); T-044 uses them).
// Null when the version is not active or the role does not book.
export async function serviceRequirements(db: pg.ClientBase, versionId: string): Promise<ServiceRows | null> {
  const j = (await db.query(`select catalog_service_requirements($1) as r`, [versionId])).rows[0].r;
  if (!j) return null;
  return { resources: j.resources, eligibility: (j.eligibility as { role: string | null; staff_id: string | null; mode: string }[]).map((e) => ({ role: e.role, staffId: e.staff_id, mode: e.mode })) };
}

// The still-open review approval of a pending version (clinical first, then materials), as the caller
// may read it (approvals_read); null when none is open or readable. Withdrawing it withdraws the
// version; the trigger cancels the other open review (DEC-047 (2)).
export async function openReview(db: pg.ClientBase, v: { approvalId: string | null; materialsApprovalId: string | null }): Promise<string | null> {
  const ids = [v.approvalId, v.materialsApprovalId].filter((x): x is string => !!x);
  if (!ids.length) return null;
  const r = await db.query(`select id from approvals where id = any($1::uuid[]) and state = 'pending' order by type = 'catalog_clinical_review' desc limit 1`, [ids]);
  return r.rows[0]?.id ?? null;
}
