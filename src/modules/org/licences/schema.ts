// Clinical credentials (PR-73, IAM-4, DATA-12 "licences", DATA-54; T-050). Policy kind: tenant-shared, read
// through the policies of migration 0068 and written only by its definers. An STR (registration) has no branch
// and may be lifetime (no expiry, JUR-ID-9); a practice permit (SIP, SIPP, SIPA) is for one branch and always
// expires. Rows are never deleted and their recorded fields never change: a renewal or correction is a new
// row that may name the one it replaces. Verification is one decision by someone other than the holder,
// the recorder and the holder's inviter; suspension and revocation end a credential at once.
// credential_alerts records each expiry alert sent (60, 30, 7 days): ids and dates only, read by no app role.
// The module folder is `licences` (DEC-062): a folder named "credentials" is treated as a secret store by
// the device's command guard.
import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { branches, staff, tenants } from "../schema";

export const CREDENTIAL_KINDS = ["str", "sip", "sipp", "sipa"] as const;
export const PROFESSIONS = ["dokter", "dokter_gigi", "perawat", "bidan", "apoteker", "tenaga_kesehatan_lain"] as const;
export const CREDENTIAL_STATES = ["pending", "verified", "rejected", "suspended", "revoked"] as const;
export const ALERT_THRESHOLDS = [60, 30, 7] as const;

export const staffCredentials = pgTable(
  "staff_credentials",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    kind: text("kind", { enum: CREDENTIAL_KINDS }).notNull(),
    number: text("number").notNull(),
    issuer: text("issuer").notNull(),
    profession: text("profession", { enum: PROFESSIONS }).notNull(),
    scope: text("scope"),
    branchId: uuid("branch_id"),
    validFrom: date("valid_from").notNull(),
    expiresOn: date("expires_on"),
    evidenceNote: text("evidence_note"),
    replaces: uuid("replaces"),
    state: text("state", { enum: CREDENTIAL_STATES }).notNull().default("pending"),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    endedBy: uuid("ended_by"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_credentials_staff_fk", columns: [t.tenantId, t.staffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_credentials_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_credentials_recorded_by_fk", columns: [t.tenantId, t.recordedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_credentials_decided_by_fk", columns: [t.tenantId, t.decidedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_credentials_ended_by_fk", columns: [t.tenantId, t.endedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    foreignKey({ name: "staff_credentials_replaces_fk", columns: [t.tenantId, t.replaces], foreignColumns: [t.tenantId, t.id] }).onDelete("restrict"),
    unique("staff_credentials_tenant_id_id_key").on(t.tenantId, t.id),
    // At most one live (non-rejected) replacement per credential.
    uniqueIndex("staff_credentials_one_replacement").on(t.tenantId, t.replaces).where(sql`${t.replaces} is not null and ${t.state} <> 'rejected'`),
    index("staff_credentials_staff_idx").on(t.tenantId, t.staffId),
    index("staff_credentials_expiry_idx").on(t.expiresOn).where(sql`${t.expiresOn} is not null and ${t.state} in ('pending','verified')`),
    check("staff_credentials_kind_check", sql`${t.kind} in ('str','sip','sipp','sipa')
      and (${t.kind} = 'str') = (${t.branchId} is null)
      and (${t.kind} = 'str' or ${t.expiresOn} is not null)`),
    check("staff_credentials_profession_check", sql`${t.profession} in ('dokter','dokter_gigi','perawat','bidan','apoteker','tenaga_kesehatan_lain')
      and (${t.kind} <> 'sipp' or ${t.profession} = 'perawat') and (${t.kind} <> 'sipa' or ${t.profession} = 'apoteker')
      and (${t.kind} <> 'sip' or ${t.profession} in ('dokter','dokter_gigi','bidan','tenaga_kesehatan_lain'))`),
    check("staff_credentials_text_check", sql`length(btrim(${t.number})) between 3 and 60 and length(btrim(${t.issuer})) between 3 and 120
      and (${t.scope} is null or length(btrim(${t.scope})) between 1 and 200) and (${t.evidenceNote} is null or length(btrim(${t.evidenceNote})) between 1 and 300)
      and (${t.expiresOn} is null or ${t.expiresOn} >= ${t.validFrom}) and (${t.replaces} is null or ${t.replaces} <> ${t.id})`),
    check("staff_credentials_state_check", sql`${t.state} in ('pending','verified','rejected','suspended','revoked')
      and ((${t.state} = 'pending') = (${t.decidedAt} is null)) and ((${t.decidedAt} is null) = (${t.decidedBy} is null))
      and ((${t.state} = 'rejected') = (${t.decisionReason} is not null)) and (${t.decisionReason} is null or length(btrim(${t.decisionReason})) between 3 and 500)
      and ((${t.state} in ('suspended','revoked')) = (${t.endedAt} is not null)) and ((${t.endedAt} is null) = (${t.endedBy} is null))
      and ((${t.endedAt} is null) = (${t.endReason} is null)) and (${t.endReason} is null or length(btrim(${t.endReason})) between 3 and 500)
      and (${t.state} not in ('suspended','revoked') or ${t.decidedAt} is not null)`),
    // IAM-4: the verifier is never the holder or the recorder (the inviter is checked by the writer).
    check("staff_credentials_verifier_check", sql`${t.decidedBy} is null or (${t.decidedBy} <> ${t.staffId} and ${t.decidedBy} <> ${t.recordedBy})`),
  ],
);

export const credentialAlerts = pgTable(
  "credential_alerts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    credentialId: uuid("credential_id").notNull(),
    threshold: integer("threshold").notNull(),
    alertedOn: date("alerted_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "credential_alerts_credential_fk", columns: [t.tenantId, t.credentialId], foreignColumns: [staffCredentials.tenantId, staffCredentials.id] }).onDelete("restrict"),
    unique("credential_alerts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("credential_alerts_once_key").on(t.tenantId, t.credentialId, t.threshold),
    check("credential_alerts_threshold_check", sql`${t.threshold} in (60, 30, 7)`),
  ],
);
