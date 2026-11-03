// Compliance register (PR-97, DATA-71, P-26). Experts never log in: their output enters
// as evidence. Policy kinds (DATA-71):
// - compliance_obligations, feature_gates, compliance_config_versions: platform registries
//   (the PR-97 obligation catalogue, which obligations each gated feature needs, and the
//   configuration versions approvals bind to);
// - vendor_evidence_items: platform rows for vendor-level obligations (vendor staff only;
//   the vendor console keeps the documents; a tenant sees their status through
//   compliance_register());
// - compliance_config_versions (migration 0030): the configuration versions approvals bind
//   to, written by their owners (posting map task, vendor profile);
// - evidence_items / evidence_files / evidence_approvals: tenant-shared rows for tenant
//   obligations, composite tenant keys (05 §3.1).
// An approval names the evidence file version (and, where the obligation has one, the
// configuration version) it covers: a newer file or configuration re-opens the gate until
// approved again; expiry or revocation closes it. Gates are evaluated server-side on every
// gated action (assertFeatureGate locks the evidence it read until the action commits).
import { sql } from "drizzle-orm";
import { bigint, check, customType, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { staff, tenants } from "../org/schema";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const EVIDENCE_STATES = ["submitted", "approved", "rejected", "revoked"] as const;

export const complianceObligations = pgTable(
  "compliance_obligations",
  {
    key: text("key").primaryKey(),
    scope: text("scope", { enum: ["vendor", "tenant"] }).notNull(),
    label: text("label").notNull(), // Indonesian, shown in Kepatuhan
    // Who uploads and approves tenant items (07 "Compliance register"): the owner always;
    // the facility head clinical items, finance tax and accounting items.
    area: text("area", { enum: ["legal", "tax", "accounting", "clinical", "privacy", "operations"] }).notNull(),
    // An approval covers a configuration version as well (posting map, residency
    // locations); a newer configuration re-opens the gate.
    configKind: text("config_kind"),
    // How long an approved item stays valid, in months (null = until revoked).
    validMonths: integer("valid_months"),
  },
  (t) => [
    check("compliance_obligations_key_check", sql`${t.key} ~ '^[a-z][a-z0-9_]{2,60}$'`),
    check("compliance_obligations_scope_check", sql`${t.scope} in ('vendor','tenant')`),
    check("compliance_obligations_area_check", sql`${t.area} in ('legal','tax','accounting','clinical','privacy','operations')`),
    check("compliance_obligations_valid_check", sql`${t.validMonths} is null or ${t.validMonths} between 1 and 120`),
  ],
);

export const featureGates = pgTable(
  "feature_gates",
  {
    key: text("key").notNull(),
    obligationKey: text("obligation_key")
      .notNull()
      .references(() => complianceObligations.key, { onDelete: "restrict" }),
  },
  (t) => [
    unique("feature_gates_key_obligation_key").on(t.key, t.obligationKey),
    check("feature_gates_key_check", sql`${t.key} ~ '^[a-z][a-z0-9_]{2,60}$'`),
  ],
);

// Vendor-level evidence (platform): one row per vendor obligation, written by the vendor
// console (T-020+; the platform operator until then).
export const vendorEvidenceItems = pgTable(
  "vendor_evidence_items",
  {
    obligationKey: text("obligation_key")
      .primaryKey()
      .references(() => complianceObligations.key, { onDelete: "restrict" }),
    state: text("state", { enum: EVIDENCE_STATES }).notNull(),
    validUntil: date("valid_until", { mode: "string" }),
    configVersion: text("config_version"),
    fileSha256: text("file_sha256"), // the approved document's checksum (file kept by the vendor console)
    decidedBy: text("decided_by"), // vendor staff display name
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("vendor_evidence_items_state_check", sql`${t.state} in ('submitted','approved','rejected','revoked')`),
    check("vendor_evidence_items_sha_check", sql`${t.fileSha256} is null or ${t.fileSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    obligationKey: text("obligation_key")
      .notNull()
      .references(() => complianceObligations.key, { onDelete: "restrict" }),
    state: text("state", { enum: EVIDENCE_STATES }).notNull().default("submitted"),
    validUntil: date("valid_until", { mode: "string" }), // set on approval (from the obligation or the approver)
    configVersion: text("config_version"), // the configuration version the current approval covers
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    unique("evidence_items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("evidence_items_one_per_obligation").on(t.tenantId, t.obligationKey),
    check("evidence_items_state_check", sql`${t.state} in ('submitted','approved','rejected','revoked')`),
  ],
);

export const evidenceFiles = pgTable(
  "evidence_files",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    version: integer("version").notNull(),
    fileName: text("file_name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    // lazy: the file bytes live in the database (≤ 5 MB, a few documents per tenant) until
    // the object-storage adapter exists (ARCH-9); then this column becomes a storage key.
    content: bytea("content").notNull(),
    expertName: text("expert_name").notNull(), // who wrote it (consultant, accountant, lawyer)
    documentDate: date("document_date", { mode: "string" }).notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    uploadedAs: text("uploaded_as").notNull(),
    uploadedName: text("uploaded_name").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [evidenceItems.tenantId, evidenceItems.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.uploadedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("evidence_files_tenant_id_id_key").on(t.tenantId, t.id),
    unique("evidence_files_tenant_item_id_key").on(t.tenantId, t.itemId, t.id),
    unique("evidence_files_item_version_key").on(t.itemId, t.version),
    check("evidence_files_sha_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("evidence_files_checksum_check", sql`${t.sha256} = encode(sha256(${t.content}), 'hex')`),
    check("evidence_files_size_check", sql`${t.sizeBytes} between 1 and 5242880 and ${t.sizeBytes} = octet_length(${t.content})`),
    check("evidence_files_media_check", sql`${t.mediaType} in ('application/pdf','image/png','image/jpeg')`),
    check("evidence_files_name_check", sql`length(${t.fileName}) between 1 and 200 and ${t.fileName} !~ '[/\\\\]'`),
    check("evidence_files_expert_check", sql`length(btrim(${t.expertName})) between 2 and 120`),
  ],
);

export const evidenceApprovals = pgTable(
  "evidence_approvals",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    // Decision order (monotonic, unlike timestamps taken at transaction start).
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    fileId: uuid("file_id").notNull(), // a file of this item (composite FK below)
    configVersion: text("config_version"),
    decision: text("decision", { enum: ["approved", "rejected", "revoked"] }).notNull(),
    reason: text("reason"),
    validUntil: date("valid_until", { mode: "string" }),
    decidedBy: uuid("decided_by").notNull(),
    decidedAs: text("decided_as").notNull(),
    decidedName: text("decided_name").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [evidenceItems.tenantId, evidenceItems.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.itemId, t.fileId], foreignColumns: [evidenceFiles.tenantId, evidenceFiles.itemId, evidenceFiles.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.decidedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("evidence_approvals_tenant_id_id_key").on(t.tenantId, t.id),
    check("evidence_approvals_decision_check", sql`${t.decision} in ('approved','rejected','revoked')`),
    check("evidence_approvals_reason_check", sql`${t.decision} = 'approved' or length(btrim(coalesce(${t.reason}, ''))) >= 3`),
    index("evidence_approvals_item_idx").on(t.itemId, t.seq),
  ],
);
