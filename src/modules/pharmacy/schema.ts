// Pharmacy module schemas (PR-18, DATA-20, DATA-26, TD-6; T-065, migration 0082, DEC-075). Written only by the 0082
// definers; quantities numeric in the stock item's unit (DATA-4), bounded, at most 4 decimals.
//
// - selections / selection_items (DATA-20 subset; personal): what the patient takes this visit, confirmed once by the
//   BC, doctor or front office. A service item becomes treatment materials (recipe map × qty, prepared by the
//   pharmacist into a T-062 material request); a product item becomes a queued dispensing.
// - pharmacy_recipe_items (config): a service version's free-text recipe row → a stock item and quantity per treatment.
// - pharmacy_special_items (config): narcotics / psychotropics, never prescribed or dispensed (insert-only, PR-18).
// - prescriptions / prescription_items (DATA-26; clinical): the doctor's draft, signed once (step-up), valid per SET-48.
// - dispensings / dispensing_lines / labels (DATA-26, DATA-72; clinical): one dispensing per product selection item or
//   prescription item; prepared (no stock moves, CLIN-017), handed over once after the seven checks (CLIN-018), its
//   batches written at the handover; one label row per dispensing with its print count.
// - stock_batch_holds (personal): every batch hold and release with its reason (insert-only history, PR-18).
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { catalogItems, catalogVersions } from "../catalog/schema";
import { planItems } from "../clinical/schema";
import { depots, stockBatches, stockItems } from "../inventory/schema";
import { materialRequests } from "../inventory/schema";
import { branches, staff, tenants } from "../org/schema";
import { patients } from "../patients/schema";
import { visits } from "../visits/schema";

export const SELECTION_KINDS = ["service", "product"] as const;
export const PRESCRIPTION_STATES = ["draft", "signed"] as const;
export const DISPENSING_STATES = ["queued", "prepared", "handed", "cancelled"] as const;
export const LABEL_KINDS = ["internal", "external_use"] as const;
// CD-19: the seven pharmacist checks (identity of patient and prescriber is one check).
export const PHARMACIST_CHECKS = ["identity", "validity", "dose", "allergy", "clarification", "label", "counselling"] as const;
export const HOLD_STATES = ["active", "quarantined", "temperature_excursion", "recalled"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const qty = (c: unknown) => sql`${c} between 0.0001 and 1000000000 and scale(${c}) <= 4`;
const text3 = (c: unknown, max: number) => sql`length(btrim(${c})) between 3 and ${sql.raw(String(max))}`;

export const selections = pgTable(
  "selections",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    guidingBcStaffId: uuid("guiding_bc_staff_id"),
    closingBcStaffId: uuid("closing_bc_staff_id"),
    // The patient's agreement capture belongs to UX-7 Konfirmasi (open UI item); null until then.
    signatureRef: text("signature_ref"),
    commandKey: text("command_key").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    confirmedBy: uuid("confirmed_by").notNull(),
    confirmedAs: text("confirmed_as").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "selections_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "selections_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "selections_guiding_fk", columns: [t.tenantId, t.guidingBcStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "selections_closing_fk", columns: [t.tenantId, t.closingBcStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "selections_by_fk", columns: [t.tenantId, t.confirmedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("selections_tenant_id_id_key").on(t.tenantId, t.id),
    unique("selections_scope_key").on(t.tenantId, t.branchId, t.visitId, t.id),
    unique("selections_visit_key").on(t.tenantId, t.visitId),
    unique("selections_command_key").on(t.tenantId, t.commandKey),
    check("selections_check", sql`${KEY(t.commandKey)} and ${t.confirmedAs} in ('bc','doctor','fo_cashier')
      and (${t.signatureRef} is null or length(${t.signatureRef}) between 8 and 200)`),
  ],
);

export const selectionItems = pgTable(
  "selection_items",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    selectionId: uuid("selection_id").notNull(),
    kind: text("kind", { enum: SELECTION_KINDS }).notNull(),
    planItemId: uuid("plan_item_id"),
    catalogVersionId: uuid("catalog_version_id").notNull(),
    quantity: numeric("quantity").notNull(),
    // Service items: the T-062 request the pharmacist prepared (set once).
    materialRequestId: uuid("material_request_id"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "selection_items_selection_fk", columns: [t.tenantId, t.branchId, t.visitId, t.selectionId],
      foreignColumns: [selections.tenantId, selections.branchId, selections.visitId, selections.id] }).onDelete("restrict"),
    foreignKey({ name: "selection_items_plan_item_fk", columns: [t.tenantId, t.planItemId], foreignColumns: [planItems.tenantId, planItems.id] }).onDelete("restrict"),
    foreignKey({ name: "selection_items_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "selection_items_request_fk", columns: [t.tenantId, t.visitId, t.materialRequestId], foreignColumns: [materialRequests.tenantId, materialRequests.visitId, materialRequests.id] }).onDelete("restrict"),
    unique("selection_items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("selection_items_scope_key").on(t.tenantId, t.branchId, t.visitId, t.id),
    unique("selection_items_plan_item_key").on(t.tenantId, t.selectionId, t.planItemId),
    unique("selection_items_request_key").on(t.tenantId, t.materialRequestId),
    check("selection_items_check", sql`${t.kind} in (${inList(SELECTION_KINDS)}) and ${qty(t.quantity)}
      and (${t.materialRequestId} is null or ${t.kind} = 'service')`),
  ],
);

export const pharmacyRecipeItems = pgTable(
  "pharmacy_recipe_items",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    catalogVersionId: uuid("catalog_version_id").notNull(),
    rowIndex: integer("row_index").notNull(),
    stockItemId: uuid("stock_item_id").notNull(),
    quantity: numeric("quantity").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    setBy: uuid("set_by").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "pharmacy_recipe_items_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "pharmacy_recipe_items_item_fk", columns: [t.tenantId, t.stockItemId], foreignColumns: [stockItems.tenantId, stockItems.id] }).onDelete("restrict"),
    foreignKey({ name: "pharmacy_recipe_items_by_fk", columns: [t.tenantId, t.setBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("pharmacy_recipe_items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("pharmacy_recipe_items_row_key").on(t.tenantId, t.catalogVersionId, t.rowIndex),
    check("pharmacy_recipe_items_check", sql`${t.rowIndex} between 0 and 49 and ${qty(t.quantity)}`),
  ],
);

export const pharmacySpecialItems = pgTable(
  "pharmacy_special_items",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    catalogItemId: uuid("catalog_item_id").notNull(),
    reason: text("reason").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    addedBy: uuid("added_by").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "pharmacy_special_items_item_fk", columns: [t.tenantId, t.catalogItemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }).onDelete("restrict"),
    foreignKey({ name: "pharmacy_special_items_by_fk", columns: [t.tenantId, t.addedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("pharmacy_special_items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("pharmacy_special_items_item_key").on(t.tenantId, t.catalogItemId),
    check("pharmacy_special_items_check", text3(t.reason, 300)),
  ],
);

export const prescriptions = pgTable(
  "prescriptions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    prescriberStaffId: uuid("prescriber_staff_id").notNull(),
    state: text("state", { enum: PRESCRIPTION_STATES }).notNull().default("draft"),
    isAcute: boolean("is_acute").notNull().default(false),
    commandKey: text("command_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    set48Snapshot: jsonb("set48_snapshot"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "prescriptions_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "prescriptions_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "prescriptions_prescriber_fk", columns: [t.tenantId, t.prescriberStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("prescriptions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("prescriptions_scope_key").on(t.tenantId, t.branchId, t.visitId, t.id),
    unique("prescriptions_command_key").on(t.tenantId, t.commandKey),
    index("prescriptions_visit_idx").on(t.tenantId, t.visitId),
    check("prescriptions_check", sql`${t.state} in (${inList(PRESCRIPTION_STATES)}) and ${KEY(t.commandKey)}
      and ((${t.state} = 'signed') = (${t.signedAt} is not null)) and num_nonnulls(${t.signedAt}, ${t.validUntil}, ${t.set48Snapshot}) in (0, 3)
      and (${t.validUntil} is null or ${t.validUntil} > ${t.signedAt})`),
  ],
);

export const prescriptionItems = pgTable(
  "prescription_items",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    prescriptionId: uuid("prescription_id").notNull(),
    catalogVersionId: uuid("catalog_version_id").notNull(),
    stockItemId: uuid("stock_item_id").notNull(),
    kfaCode: text("kfa_code"),
    // Dose, route, frequency and duration as the doctor writes them (CD-19 check "dose").
    signa: text("signa").notNull(),
    quantity: numeric("quantity").notNull(),
    externalUse: boolean("external_use").notNull().default(false),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "prescription_items_prescription_fk", columns: [t.tenantId, t.branchId, t.visitId, t.prescriptionId],
      foreignColumns: [prescriptions.tenantId, prescriptions.branchId, prescriptions.visitId, prescriptions.id] }).onDelete("restrict"),
    foreignKey({ name: "prescription_items_version_fk", columns: [t.tenantId, t.catalogVersionId], foreignColumns: [catalogVersions.tenantId, catalogVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "prescription_items_item_fk", columns: [t.tenantId, t.stockItemId], foreignColumns: [stockItems.tenantId, stockItems.id] }).onDelete("restrict"),
    unique("prescription_items_tenant_id_id_key").on(t.tenantId, t.id),
    unique("prescription_items_scope_key").on(t.tenantId, t.branchId, t.visitId, t.id),
    check("prescription_items_check", sql`${qty(t.quantity)} and ${text3(t.signa, 200)}
      and (${t.kfaCode} is null or ${t.kfaCode} ~ '^[0-9A-Za-z.-]{3,40}$')`),
  ],
);

export const dispensings = pgTable(
  "dispensings",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    selectionItemId: uuid("selection_item_id"),
    prescriptionItemId: uuid("prescription_item_id"),
    stockItemId: uuid("stock_item_id").notNull(),
    quantity: numeric("quantity").notNull(),
    externalUse: boolean("external_use").notNull().default(false),
    state: text("state", { enum: DISPENSING_STATES }).notNull().default("queued"),
    depotId: uuid("depot_id"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    preparedBy: uuid("prepared_by"),
    prepareKey: text("prepare_key"),
    handedAt: timestamp("handed_at", { withTimezone: true }),
    handedBy: uuid("handed_by"),
    handKey: text("hand_key"),
    checks: jsonb("checks"),
    exceptionNote: text("exception_note"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensings_visit_fk", columns: [t.tenantId, t.branchId, t.visitId], foreignColumns: [visits.tenantId, visits.branchId, visits.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensings_patient_fk", columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensings_selection_item_fk", columns: [t.tenantId, t.branchId, t.visitId, t.selectionItemId],
      foreignColumns: [selectionItems.tenantId, selectionItems.branchId, selectionItems.visitId, selectionItems.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensings_prescription_item_fk", columns: [t.tenantId, t.branchId, t.visitId, t.prescriptionItemId],
      foreignColumns: [prescriptionItems.tenantId, prescriptionItems.branchId, prescriptionItems.visitId, prescriptionItems.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensings_item_fk", columns: [t.tenantId, t.stockItemId], foreignColumns: [stockItems.tenantId, stockItems.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensings_depot_fk", columns: [t.tenantId, t.branchId, t.depotId], foreignColumns: [depots.tenantId, depots.branchId, depots.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensings_prepared_by_fk", columns: [t.tenantId, t.preparedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensings_handed_by_fk", columns: [t.tenantId, t.handedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensings_cancelled_by_fk", columns: [t.tenantId, t.cancelledBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("dispensings_tenant_id_id_key").on(t.tenantId, t.id),
    unique("dispensings_scope_key").on(t.tenantId, t.branchId, t.id),
    unique("dispensings_selection_item_key").on(t.tenantId, t.selectionItemId),
    unique("dispensings_prescription_item_key").on(t.tenantId, t.prescriptionItemId),
    unique("dispensings_prepare_key").on(t.tenantId, t.prepareKey),
    unique("dispensings_hand_key").on(t.tenantId, t.handKey),
    index("dispensings_queue_idx").on(t.tenantId, t.branchId, t.state, t.queuedAt),
    check("dispensings_check", sql`${t.state} in (${inList(DISPENSING_STATES)}) and ${qty(t.quantity)}
      and num_nonnulls(${t.selectionItemId}, ${t.prescriptionItemId}) = 1
      and num_nonnulls(${t.preparedAt}, ${t.preparedBy}, ${t.prepareKey}, ${t.depotId}) in (0, 4)
      and num_nonnulls(${t.handedAt}, ${t.handedBy}, ${t.handKey}, ${t.checks}) in (0, 4)
      and num_nonnulls(${t.cancelledAt}, ${t.cancelledBy}, ${t.cancelReason}) in (0, 3)
      and ((${t.state} in ('prepared','handed')) <= (${t.preparedAt} is not null))
      and ((${t.state} = 'handed') = (${t.handedAt} is not null)) and ((${t.state} = 'cancelled') = (${t.cancelledAt} is not null))
      and (${t.prepareKey} is null or ${KEY(t.prepareKey)}) and (${t.handKey} is null or ${KEY(t.handKey)})
      and (${t.checks} is null or jsonb_typeof(${t.checks}) = 'object')
      and (${t.exceptionNote} is null or ${text3(t.exceptionNote, 500)}) and (${t.exceptionNote} is null or ${t.handedAt} is not null)
      and (${t.cancelReason} is null or ${text3(t.cancelReason, 300)})`),
  ],
);

export const dispensingLines = pgTable(
  "dispensing_lines",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    dispensingId: uuid("dispensing_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    quantity: numeric("quantity").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensing_lines_dispensing_fk", columns: [t.tenantId, t.branchId, t.dispensingId], foreignColumns: [dispensings.tenantId, dispensings.branchId, dispensings.id] }).onDelete("restrict"),
    foreignKey({ name: "dispensing_lines_batch_fk", columns: [t.tenantId, t.branchId, t.batchId], foreignColumns: [stockBatches.tenantId, stockBatches.branchId, stockBatches.id] }).onDelete("restrict"),
    unique("dispensing_lines_tenant_id_id_key").on(t.tenantId, t.id),
    unique("dispensing_lines_batch_key").on(t.tenantId, t.dispensingId, t.batchId),
    index("dispensing_lines_batch_idx").on(t.tenantId, t.batchId),
    check("dispensing_lines_check", qty(t.quantity)),
  ],
);

export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    dispensingId: uuid("dispensing_id").notNull(),
    kind: text("kind", { enum: LABEL_KINDS }).notNull(),
    printCount: integer("print_count").notNull().default(1),
    firstPrintedAt: timestamp("first_printed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    lastPrintedAt: timestamp("last_printed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    lastPrintedBy: uuid("last_printed_by").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "labels_dispensing_fk", columns: [t.tenantId, t.branchId, t.dispensingId], foreignColumns: [dispensings.tenantId, dispensings.branchId, dispensings.id] }).onDelete("restrict"),
    foreignKey({ name: "labels_by_fk", columns: [t.tenantId, t.lastPrintedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("labels_tenant_id_id_key").on(t.tenantId, t.id),
    unique("labels_dispensing_key").on(t.tenantId, t.dispensingId),
    check("labels_check", sql`${t.kind} in (${inList(LABEL_KINDS)}) and ${t.printCount} between 1 and 1000 and ${t.lastPrintedAt} >= ${t.firstPrintedAt}`),
  ],
);

export const stockBatchHolds = pgTable(
  "stock_batch_holds",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    fromState: text("from_state", { enum: HOLD_STATES }).notNull(),
    toState: text("to_state", { enum: HOLD_STATES }).notNull(),
    reason: text("reason").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    by: uuid("by").notNull(),
    as: text("as").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_batch_holds_batch_fk", columns: [t.tenantId, t.branchId, t.batchId], foreignColumns: [stockBatches.tenantId, stockBatches.branchId, stockBatches.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_batch_holds_by_fk", columns: [t.tenantId, t.by], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "stock_batch_holds_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    unique("stock_batch_holds_tenant_id_id_key").on(t.tenantId, t.id),
    index("stock_batch_holds_batch_idx").on(t.tenantId, t.batchId, t.at),
    check("stock_batch_holds_check", sql`${t.fromState} in (${inList(HOLD_STATES)}) and ${t.toState} in (${inList(HOLD_STATES)})
      and ${t.fromState} <> ${t.toState} and ${t.as} = 'pharmacist' and ${text3(t.reason, 300)}`),
  ],
);
