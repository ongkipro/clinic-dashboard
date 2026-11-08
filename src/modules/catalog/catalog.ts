// Catalog commands and reads (PR-41, T-033). Every call runs inside withTenantContext; the
// catalog_* functions (migration 0054) enforce roles, the clinical review gate (DEC-046), the item
// lock while a review is pending, and immutability. Clinical review decisions go through the
// approvals engine (decideApproval / cancelApproval): a trigger moves the version on every path.
import type pg from "pg";
import { CommandError, type ErrorCode } from "../../lib/command";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_VERSION_CONFLICT", "ERR_INVALID_INPUT", "ERR_IDEMPOTENCY_CONFLICT"]);

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
    if (m && KNOWN.has(m[1])) throw new CatalogError(m[1] as ErrorCode, m[2] === "catalog_review_pending" ? "catalog_review_pending" : undefined);
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
};

export type Published = { itemId: string; versionId: string; version: number; state: "active" | "pending_review"; approvalId: string | null };

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
  return { itemId: j.item_id, versionId: j.version_id, version: j.version, state: j.state, approvalId: j.approval_id };
}

export type CommercialRow = {
  itemId: string; versionId: string; version: number; kind: string; code: string; name: string; taxCategory: string; taxBasis: string;
  normalPrice: number; controlCount: number; controlValidityDays: number | null; bookingDpEnabled: boolean; bookingDpAmount: number | null;
  minDpPct: number | null; installmentsAllowed: boolean; validityDays: number | null; commissionScope: string[]; pendingReview: boolean;
};

// Active versions without clinical content, for every member (DEC-046 (2)).
export async function commercialCatalog(db: pg.ClientBase): Promise<CommercialRow[]> {
  return (await db.query(`select * from catalog_commercial()`)).rows.map((r) => ({
    itemId: r.item_id, versionId: r.version_id, version: r.version, kind: r.kind, code: r.code, name: r.name, taxCategory: r.tax_category,
    taxBasis: r.tax_basis, normalPrice: Number(r.normal_price), controlCount: r.control_count, controlValidityDays: r.control_validity_days,
    bookingDpEnabled: r.booking_dp_enabled, bookingDpAmount: r.booking_dp_amount === null ? null : Number(r.booking_dp_amount),
    minDpPct: r.min_dp_pct, installmentsAllowed: r.installments_allowed, validityDays: r.validity_days, commissionScope: r.commission_scope,
    pendingReview: r.pending_review,
  }));
}

export type VersionRow = {
  id: string; itemId: string; version: number; state: string; name: string; taxCategory: string; taxBasis: string; normalPrice: number;
  controlCount: number; controlValidityDays: number | null; bookingDpEnabled: boolean; bookingDpAmount: number | null; minDpPct: number | null;
  installmentsAllowed: boolean; validityDays: number | null; commissionScope: string[]; materialFormula: unknown[]; indications: string | null; contraindications: string | null;
  consentTemplate: string | null; delegation: string | null; reason: string; createdBy: string; createdAs: string; createdAt: Date;
  approvalId: string | null; decidedAt: Date | null; referencedAt: Date | null;
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
    decidedAt: r.decided_at, referencedAt: r.referenced_at,
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

// The catalog version a catalog_clinical_review approval decides (review round 1, P1): shown in the
// Persetujuan detail with the proposed and the active clinical fields.
export type ReviewTarget = {
  itemId: string; code: string; name: string; version: number; state: string;
  proposed: { indications: string | null; contraindications: string | null; consentTemplate: string | null; delegation: string | null };
  active: { indications: string | null; contraindications: string | null; consentTemplate: string | null; delegation: string | null } | null;
};
export async function reviewTarget(db: pg.ClientBase, approvalId: string): Promise<ReviewTarget | null> {
  const r = (await db.query(`select * from catalog_review_target($1)`, [approvalId])).rows[0];
  if (!r) return null;
  return {
    itemId: r.item_id, code: r.code, name: r.name, version: r.version, state: r.state,
    proposed: { indications: r.indications, contraindications: r.contraindications, consentTemplate: r.consent_template, delegation: r.delegation },
    active: r.has_active ? { indications: r.active_indications, contraindications: r.active_contraindications, consentTemplate: r.active_consent_template, delegation: r.active_delegation } : null,
  };
}
