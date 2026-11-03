import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { authUser } from "../../auth/schema";

// Platform registry of every tenant (DATA-10, TEN-9, TEN-12). Policy kind: platform.
// Vendor tables reference it by `tenant_id`; it never joins tenant rows directly (TEN-16).
export const tenantLifecycleStates = [
  "provisioning",
  "onboarding",
  "live",
  "suspended",
  "exit",
  "closed",
] as const;

export const tenantsRegistry = pgTable(
  "tenants_registry",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    lifecycleState: text("lifecycle_state", { enum: tenantLifecycleStates })
      .notNull()
      .default("provisioning"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "tenants_registry_lifecycle_state_check",
      sql`${t.lifecycleState} in ('provisioning','onboarding','live','suspended','exit','closed')`,
    ),
  ],
);

// Vendor profile (DATA-47, PR-55, S-04, H-02d). One row (id = 1), policy kind platform:
// only the platform operator connection writes it; the clinic app reads the public
// identity through the vendor_identity() security-definer function. A field listed in
// `placeholder_fields`, or still holding a "[...]" placeholder, is shown marked and
// blocks production go-live. Storage locations are declared per kind (PR-36); the
// residency opinion (H-02d) is set by the product owner only (profile module) and every
// change is recorded in vendor_profile_changes.
export const VENDOR_PROFILE_FIELDS = [
  "legal_name",
  "nib",
  "pse_number",
  "npwp",
  "meta_business_id",
  "website",
  "privacy_url",
  "support_email",
  "support_phone",
] as const;
export type VendorProfileField = (typeof VENDOR_PROFILE_FIELDS)[number];

export const STORAGE_KINDS = ["database", "object_storage", "backups", "logs", "error_tracking"] as const;

export const vendorProfile = pgTable(
  "vendor_profile",
  {
    id: integer("id").primaryKey().default(1),
    legalName: text("legal_name").notNull(),
    nib: text("nib").notNull(),
    pseNumber: text("pse_number").notNull(),
    npwp: text("npwp").notNull(),
    metaBusinessId: text("meta_business_id").notNull(),
    website: text("website").notNull(),
    privacyUrl: text("privacy_url").notNull(),
    supportEmail: text("support_email").notNull(),
    supportPhone: text("support_phone").notNull(),
    placeholderFields: text("placeholder_fields").array().notNull().default(sql`'{}'::text[]`),
    // [{ kind, provider, region, country }] with country an ISO 3166-1 alpha-2 code.
    storageLocations: jsonb("storage_locations").notNull().default(sql`'[]'::jsonb`),
    // Vendor tax profile (DATA-47); the evidence item arrives with the compliance register.
    isPkp: boolean("is_pkp").notNull().default(false),
    pkpEffectiveFrom: date("pkp_effective_from"),
    taxEvidenceRef: text("tax_evidence_ref"),
    residencyOpinionRef: text("residency_opinion_ref"),
    residencyOpinionDate: date("residency_opinion_date"),
    residencyOpinionOutcome: text("residency_opinion_outcome", { enum: ["positive", "negative"] }),
    residencyOpinionSetBy: uuid("residency_opinion_set_by").references(() => authUser.id, { onDelete: "restrict" }),
    residencyOpinionChecksum: text("residency_opinion_checksum"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("vendor_profile_singleton_check", sql`${t.id} = 1`),
    // No empty identity value can pass as "filled" (placeholder detection fails closed).
    check(
      "vendor_profile_not_blank_check",
      sql.raw(
        VENDOR_PROFILE_FIELDS.map((f) => `btrim("${f}") <> ''`).join(" and "),
      ),
    ),
    check("vendor_profile_tax_evidence_check", sql`${t.taxEvidenceRef} is null or btrim(${t.taxEvidenceRef}) <> ''`),
    check(
      "vendor_profile_placeholder_fields_check",
      sql`${t.placeholderFields} <@ array[${sql.raw(VENDOR_PROFILE_FIELDS.map((f) => `'${f}'`).join(","))}]::text[]`,
    ),
    check("vendor_profile_storage_locations_check", sql`jsonb_typeof(${t.storageLocations}) = 'array'`),
    check("vendor_profile_pkp_check", sql`not ${t.isPkp} or (${t.pkpEffectiveFrom} is not null and ${t.taxEvidenceRef} is not null)`),
    check(
      "vendor_profile_residency_check",
      sql`(${t.residencyOpinionOutcome} is null) = (${t.residencyOpinionRef} is null)
       and (${t.residencyOpinionOutcome} is null) = (${t.residencyOpinionDate} is null)
       and (${t.residencyOpinionOutcome} is null) = (${t.residencyOpinionSetBy} is null)
       and (${t.residencyOpinionOutcome} is null) = (${t.residencyOpinionChecksum} is null)
       and (${t.residencyOpinionOutcome} is null or ${t.residencyOpinionOutcome} in ('positive','negative'))
       and (${t.residencyOpinionChecksum} is null or ${t.residencyOpinionChecksum} ~ '^[0-9a-f]{64}$')`,
    ),
  ],
);

// Append-only history of profile changes (PR-55 "audited"): who, in which vendor role,
// which field, old and new value. Values are vendor business identity, never personal
// or clinical data.
export const vendorProfileChanges = pgTable(
  "vendor_profile_changes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorAccountId: uuid("actor_account_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "restrict" }),
    actorRole: text("actor_role").notNull(),
    field: text("field").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    reason: text("reason").notNull(),
  },
  (t) => [
    check("vendor_profile_changes_role_check", sql`${t.actorRole} ~ '^[a-z][a-z_]{1,40}$'`),
    check("vendor_profile_changes_field_check", sql`${t.field} ~ '^[a-z][a-z_]{1,40}$'`),
    check("vendor_profile_changes_reason_check", sql`length(btrim(${t.reason})) between 3 and 500`),
  ],
);

// Vendor staff (PR-57, IAM-10, DATA-48). Level 1 roles live only in the vendor console and
// never imply clinic memberships. Policy kind platform: written only by the vendor_staff_*
// functions (migration 0032) on the platform operator connection, each attributed to an
// active vendor staff member with TOTP enrolled, from an allowed IP, and logged in
// vendor_actions.
export const VENDOR_ROLES = ["platform_owner", "onboarding", "support", "vendor_finance", "vendor_auditor"] as const;

export const vendorStaff = pgTable(
  "vendor_staff",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    accountId: uuid("account_id")
      .notNull()
      .unique()
      .references(() => authUser.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    state: text("state", { enum: ["active", "suspended", "exited"] }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true }),
  },
  (t) => [
    check("vendor_staff_state_check", sql`${t.state} in ('active','suspended','exited')`),
    check("vendor_staff_name_check", sql`length(btrim(${t.displayName})) between 2 and 120`),
  ],
);

export const vendorStaffRoles = pgTable(
  "vendor_staff_roles",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => vendorStaff.id, { onDelete: "restrict" }),
    role: text("role", { enum: VENDOR_ROLES }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("vendor_staff_roles_key").on(t.staffId, t.role),
    check("vendor_staff_roles_role_check", sql`${t.role} in ('platform_owner','onboarding','support','vendor_finance','vendor_auditor')`),
  ],
);

// Console IP allowlist (IAM-10, SEC-16): CIDR ranges; empty = no console access at all.
export const vendorIpAllowlist = pgTable(
  "vendor_ip_allowlist",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    cidr: text("cidr").notNull().unique(),
    label: text("label").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("vendor_ip_allowlist_label_check", sql`length(btrim(${t.label})) between 2 and 80`)],
);

// Maker-checker requests (PR-57): clinical-data grant, suspension, exit, server-fee change,
// invoice waiver, and the dual vendor/clinic identity. The requester never decides; the
// platform owner approves; a dual identity also needs that clinic owner's approval.
// reactivation (suspended → live) and closure (exit → closed) arrive with T-022 (PR-56).
export const VENDOR_REQUEST_KINDS = ["clinical_grant", "suspension", "exit", "server_fee_change", "invoice_waiver", "dual_identity", "reactivation", "closure"] as const;

export const vendorRequests = pgTable(
  "vendor_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    kind: text("kind", { enum: VENDOR_REQUEST_KINDS }).notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    // What is asked (ids and amounts only; validated per kind by the functions).
    payload: jsonb("payload").notNull(),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => vendorStaff.id, { onDelete: "restrict" }),
    requestedAs: text("requested_as").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    state: text("state", { enum: ["pending", "approved", "rejected", "cancelled"] }).notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => vendorStaff.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    // dual_identity: the clinic owner's decision (a staff member of that tenant, owner role).
    clinicApprovedBy: uuid("clinic_approved_by"),
    // The clinic approver's account: one person never supplies both halves.
    clinicApprovedAccount: uuid("clinic_approved_account").references(() => authUser.id, { onDelete: "restrict" }),
    clinicApprovedAt: timestamp("clinic_approved_at", { withTimezone: true }),
    // An approved request is executed once, by the task that owns its effect, within 30
    // days of approval (vendor_request_consume). Dual identity is a standing state instead.
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    check("vendor_requests_kind_check", sql`${t.kind} in ('clinical_grant','suspension','exit','server_fee_change','invoice_waiver','dual_identity','reactivation','closure')`),
    check("vendor_requests_state_check", sql`${t.state} in ('pending','approved','rejected','cancelled')`),
    check("vendor_requests_reason_check", sql`length(btrim(${t.reason})) between 10 and 500`),
    check("vendor_requests_payload_check", sql`jsonb_typeof(${t.payload}) = 'object'`),
    // Requester ≠ approver in the data itself.
    check("vendor_requests_maker_checker_check", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`),
    check("vendor_requests_decided_check", sql`(${t.state} = 'pending') = (${t.decidedAt} is null)`),
    check("vendor_requests_cancel_check", sql`${t.state} <> 'cancelled' or ${t.decidedBy} is null`),
    check("vendor_requests_approved_check", sql`${t.state} <> 'approved' or ${t.decidedBy} is not null`),
    check("vendor_requests_clinic_check", sql`(${t.clinicApprovedAt} is null) = (${t.clinicApprovedBy} is null) and (${t.clinicApprovedAt} is null) = (${t.clinicApprovedAccount} is null) and (${t.clinicApprovedAt} is null or ${t.kind} = 'dual_identity')`),
    check("vendor_requests_consumed_check", sql`${t.consumedAt} is null or ${t.state} = 'approved' and ${t.kind} <> 'dual_identity'`),
  ],
);

// Every vendor action (allowed and refused), PR-57 "audited": who (vendor staff, role),
// what, on which tenant, outcome, reason code. Append-only; read by the platform owner and
// the vendor auditor (UX-47).
export const vendorActions = pgTable(
  "vendor_actions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    seq: integer("seq").generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    staffId: uuid("staff_id").references(() => vendorStaff.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").references(() => authUser.id, { onDelete: "restrict" }),
    actingRole: text("acting_role"),
    action: text("action").notNull(),
    tenantId: uuid("tenant_id").references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    objectId: uuid("object_id"),
    outcome: text("outcome", { enum: ["success", "denied"] }).notNull(),
    reasonCode: text("reason_code"),
    // What changed when the object is not a row (the allowlist CIDR); never free text.
    detail: text("detail"),
    clientIp: text("client_ip"),
  },
  (t) => [
    check("vendor_actions_action_check", sql`${t.action} ~ '^[a-z][a-z_]{2,60}$'`),
    check("vendor_actions_outcome_check", sql`${t.outcome} in ('success','denied')`),
    check("vendor_actions_reason_check", sql`${t.reasonCode} is null or ${t.reasonCode} ~ '^[a-z][a-z_]{1,60}$'`),
    check("vendor_actions_detail_check", sql`${t.detail} is null or ${t.detail} ~ '^[0-9A-Fa-f:./]{2,64}$'`),
  ],
);

// T-022 (PR-56, TEN-12, DATA-48): every lifecycle transition of a tenant, append-only.
// Platform table (no clinic_app access). A transition needing maker-checker names the
// consumed vendor request; the actor is the executing service (vendor_request_consume) or,
// for onboarding steps, the vendor staff member.
export const tenantLifecycleEvents = pgTable(
  "tenant_lifecycle_events",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    seq: integer("seq").generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    fromState: text("from_state", { enum: tenantLifecycleStates }).notNull(),
    toState: text("to_state", { enum: tenantLifecycleStates }).notNull(),
    reason: text("reason").notNull(),
    actorKind: text("actor_kind", { enum: ["service", "vendor_staff"] }).notNull(),
    actor: text("actor").notNull(),
    vendorRequestId: uuid("vendor_request_id").references(() => vendorRequests.id, { onDelete: "restrict" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("tenant_lifecycle_events_request_key").on(t.vendorRequestId),
    check("tenant_lifecycle_events_states_check", sql`${t.fromState} in ('provisioning','onboarding','live','suspended','exit','closed') and ${t.toState} in ('provisioning','onboarding','live','suspended','exit','closed') and ${t.fromState} <> ${t.toState}`),
    check("tenant_lifecycle_events_reason_check", sql`length(btrim(${t.reason})) between 10 and 500`),
    check("tenant_lifecycle_events_actor_check", sql`${t.actorKind} in ('service','vendor_staff') and ${t.actor} ~ '^[a-z0-9][a-z0-9_.-]{1,80}$'`),
  ],
);

// T-023 (PR-1, DEC-033): the first-owner invitation of a new tenant, issued from the vendor
// console. Platform table. A maker (onboarding or platform owner) names the person; a
// different platform owner approves; only then is a one-time token issued (its hash is
// stored; the link is shown once). Accepting creates the Owner membership directly.
export const tenantOwnerInvitations = pgTable(
  "tenant_owner_invitations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => vendorStaff.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    // pending (waiting for the checker) → issued (token exists) → accepted | cancelled | expired
    state: text("state", { enum: ["pending", "issued", "accepted", "cancelled", "expired"] }).notNull().default("pending"),
    approvedBy: uuid("approved_by").references(() => vendorStaff.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    tokenHash: text("token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedAccount: uuid("accepted_account").references(() => authUser.id, { onDelete: "restrict" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    unique("tenant_owner_invitations_token_key").on(t.tokenHash),
    check("tenant_owner_invitations_state_check", sql`${t.state} in ('pending','issued','accepted','cancelled','expired')`),
    check("tenant_owner_invitations_email_check", sql`${t.email} = lower(${t.email}) and ${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[a-z]{2,}$' and length(${t.email}) <= 254`),
    check("tenant_owner_invitations_name_check", sql`length(btrim(${t.displayName})) between 2 and 120`),
    check("tenant_owner_invitations_token_check", sql`${t.tokenHash} is null or ${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("tenant_owner_invitations_checker_check", sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.requestedBy}`),
    // issued/accepted carry an approval and a token; accepted names the account; open
    // states (pending, issued) have no closing time.
    check(
      "tenant_owner_invitations_flow_check",
      sql`(${t.state} <> 'pending' or (${t.approvedBy} is null and ${t.tokenHash} is null))
          and (${t.state} not in ('issued','accepted') or (${t.approvedBy} is not null and ${t.tokenHash} is not null and ${t.expiresAt} is not null))
          and (${t.state} = 'accepted') = (${t.acceptedAccount} is not null)
          and (${t.state} in ('pending','issued')) = (${t.closedAt} is null)`,
    ),
  ],
);

// Tim Vendor invitations (HYG-003, DEC-036, UX-46): a platform owner invites a person with
// vendor roles; the one-time link (token hash stored) lets them set their own password and
// then enrol TOTP. Platform table; written only by the vendor_console_staff_* and
// vendor_staff_invite_* functions (migration 0042).
export const vendorStaffInvitations = pgTable(
  "vendor_staff_invitations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    roles: text("roles").array().notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => vendorStaff.id, { onDelete: "restrict" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    state: text("state", { enum: ["pending", "accepted", "cancelled", "expired"] }).notNull().default("pending"),
    acceptedStaff: uuid("accepted_staff").references(() => vendorStaff.id, { onDelete: "restrict" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    unique("vendor_staff_invitations_token_key").on(t.tokenHash),
    check("vendor_staff_invitations_state_check", sql`${t.state} in ('pending','accepted','cancelled','expired')`),
    check("vendor_staff_invitations_email_check", sql`${t.email} = lower(${t.email}) and ${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[a-z]{2,}$' and length(${t.email}) <= 254`),
    check("vendor_staff_invitations_name_check", sql`length(btrim(${t.displayName})) between 2 and 120`),
    check("vendor_staff_invitations_roles_check", sql`cardinality(${t.roles}) >= 1 and ${t.roles} <@ array['platform_owner','onboarding','support','vendor_finance','vendor_auditor']::text[]`),
    check("vendor_staff_invitations_token_check", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("vendor_staff_invitations_expiry_check", sql`${t.expiresAt} > ${t.invitedAt}`),
    check("vendor_staff_invitations_close_check", sql`(${t.state} = 'pending') = (${t.closedAt} is null) and (${t.state} = 'accepted') = (${t.acceptedStaff} is not null)`),
  ],
);

// Onboarding grant (T-024, PR-58, TEN-13): one per tenant, created when the tenant enters
// onboarding, active for 30 days (renewable once by the clinic Owner) while the tenant is
// in onboarding; ended at go-live or when the tenant leaves onboarding. Platform table.
export const onboardingGrants = pgTable(
  "onboarding_grants",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    renewedAt: timestamp("renewed_at", { withTimezone: true }),
    renewedByStaff: uuid("renewed_by_staff"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason", { enum: ["go_live", "left_onboarding"] }),
  },
  (t) => [
    check("onboarding_grants_expiry_check", sql`${t.expiresAt} > ${t.grantedAt}`),
    check("onboarding_grants_renew_check", sql`(${t.renewedAt} is null) = (${t.renewedByStaff} is null)`),
    check("onboarding_grants_end_check", sql`(${t.endedAt} is null) = (${t.endReason} is null) and (${t.endReason} is null or ${t.endReason} in ('go_live','left_onboarding'))`),
  ],
);

// Staff invitations prepared by onboarding staff under the grant: drafts until the clinic
// Owner confirms each invitee and role set (TEN-13). Confirming creates a normal invitation
// from the Owner (staff_invite). Level 3 roles only; never a vendor account's email.
export const onboardingInvitationDrafts = pgTable(
  "onboarding_invitation_drafts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    roles: text("roles").array().notNull(),
    branchIds: uuid("branch_ids").array().notNull(),
    draftedBy: uuid("drafted_by")
      .notNull()
      .references(() => vendorStaff.id, { onDelete: "restrict" }),
    draftedAt: timestamp("drafted_at", { withTimezone: true }).notNull().defaultNow(),
    state: text("state", { enum: ["draft", "confirmed", "declined"] }).notNull().default("draft"),
    decidedByStaff: uuid("decided_by_staff"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    invitationId: uuid("invitation_id"),
  },
  (t) => [
    unique("onboarding_invitation_drafts_tenant_id_id_key").on(t.tenantId, t.id),
    check("onboarding_invitation_drafts_state_check", sql`${t.state} in ('draft','confirmed','declined')`),
    check("onboarding_invitation_drafts_email_check", sql`${t.email} = lower(${t.email}) and ${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[a-z]{2,}$' and length(${t.email}) <= 254`),
    check("onboarding_invitation_drafts_name_check", sql`length(btrim(${t.displayName})) between 2 and 120`),
    check("onboarding_invitation_drafts_roles_check", sql`cardinality(${t.roles}) >= 1 and ${t.roles} <@ array['manager','fo_cashier','bc','doctor','nurse','therapist','pharmacist','central_cs','marketing','purchasing']::text[]`),
    check("onboarding_invitation_drafts_decided_check", sql`(${t.state} = 'draft') = (${t.decidedAt} is null) and (${t.state} = 'draft') = (${t.decidedByStaff} is null) and (${t.state} = 'confirmed') = (${t.invitationId} is not null)`),
  ],
);

// Support sessions (T-025, PR-53, TEN-6, TEN-14, TEN-17): a reasoned, time-limited look into
// one tenant by the vendor operator who opened it, limited to the declared tables. Platform
// table; written only by the support functions (migration 0046).
export const supportSessions = pgTable(
  "support_sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsRegistry.id, { onDelete: "restrict" }),
    openedBy: uuid("opened_by")
      .notNull()
      .references(() => vendorStaff.id, { onDelete: "restrict" }),
    purpose: text("purpose").notNull(),
    scope: text("scope").array().notNull(),
    minutes: integer("minutes").notNull(),
    state: text("state", { enum: ["pending_approval", "active", "ended"] }).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    extendedAt: timestamp("extended_at", { withTimezone: true }),
    extensionReason: text("extension_reason"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason", { enum: ["expired", "operator", "owner", "tenant_closed"] }),
  },
  (t) => [
    check("support_sessions_state_check", sql`${t.state} in ('pending_approval','active','ended')`),
    check("support_sessions_purpose_check", sql`length(btrim(${t.purpose})) between 10 and 500`),
    check("support_sessions_scope_check", sql`cardinality(${t.scope}) between 1 and 40`),
    check("support_sessions_minutes_check", sql`${t.minutes} between 5 and 120`),
    check("support_sessions_extension_check", sql`(${t.extendedAt} is null) = (${t.extensionReason} is null) and (${t.extensionReason} is null or length(btrim(${t.extensionReason})) between 10 and 500)`),
    // Pending never activated; active always activated; an ended session may never have been
    // activated (a pending request withdrawn or ended by the Owner).
    check("support_sessions_active_check", sql`(${t.state} <> 'pending_approval' or ${t.activatedAt} is null) and (${t.state} <> 'active' or ${t.activatedAt} is not null) and (${t.activatedAt} is null) = (${t.endsAt} is null) and (${t.endsAt} is null or ${t.endsAt} <= ${t.activatedAt} + interval '4 hours')`),
    check("support_sessions_end_check", sql`(${t.state} = 'ended') = (${t.endedAt} is not null) and (${t.endedAt} is null) = (${t.endReason} is null)`),
  ],
);

// The operator class of each tenant table (TEN-14/TEN-19): config (notify-only), personal and
// clinical (owner approval first, T-026), money_total (bounded views, later), never.
export const supportObjectKinds = pgTable(
  "support_object_kinds",
  {
    tableName: text("table_name").primaryKey(),
    supportClass: text("support_class", { enum: ["config", "personal", "clinical", "money_total", "never"] }).notNull(),
  },
  (t) => [check("support_object_kinds_class_check", sql`${t.supportClass} in ('config','personal','clinical','money_total','never')`)],
);

// Which backend and transaction a session is bound to right now (TEN-17): the operator
// predicate trusts the app.* settings only together with this row, so a forged setting reads
// nothing. Rows are transaction-scoped in meaning (txid); old rows are swept.
export const supportSessionBindings = pgTable(
  "support_session_bindings",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => supportSessions.id, { onDelete: "restrict" }),
    backendPid: integer("backend_pid").notNull(),
    txid: bigint("txid", { mode: "bigint" }).notNull(),
    // The vendor login session and staff member the bind was made with: the operator predicate
    // re-checks both on every statement (sign-out or deactivation stops reads at once).
    authSessionId: uuid("auth_session_id").notNull(),
    // No foreign key: a key-share lock on vendor_staff for the life of the read transaction
    // would block deactivating the operator (the predicate joins vendor_staff instead).
    staffId: uuid("staff_id").notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("support_session_bindings_key").on(t.backendPid, t.txid)],
);

// A ticket to bind a session for reading in exactly one transaction (review rounds 2–3): the read
// transaction is opened first and names its backend pid and txid; the console then issues the
// ticket for that transaction in its own short, committed transaction, which writes "bind
// issued" to the vendor log and the tenant chain. txids are never reused, so a reader's
// rollback cannot replay the ticket: every read transaction leaves its own durable trace.
// Expires 2 minutes after issue. No foreign key to vendor_staff (same reason as bindings).
export const supportBindTickets = pgTable(
  "support_bind_tickets",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => supportSessions.id, { onDelete: "restrict" }),
    staffId: uuid("staff_id").notNull(),
    authSessionId: uuid("auth_session_id").notNull(),
    backendPid: integer("backend_pid").notNull(),
    txid: bigint("txid", { mode: "bigint" }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [unique("support_bind_tickets_txid_key").on(t.txid), check("support_bind_tickets_expiry_check", sql`${t.expiresAt} > ${t.issuedAt} and ${t.expiresAt} <= ${t.issuedAt} + interval '2 minutes'`)],
);

// The records an operator's queries touched in a session (TEN-14): written by the operator RLS
// policy for each row it admits. A superset of the rows returned (a non-leakproof filter, a
// sort with LIMIT, a join or an aggregate discards rows after the policy admitted them), and
// written in the reader's transaction, so a reader's rollback removes them (DEC-038); the
// durable trace of every read transaction is its bind ticket. The Owner sees the list grouped
// by session (T-026 / T-028).
export const supportSessionReads = pgTable(
  "support_session_reads",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => supportSessions.id, { onDelete: "restrict" }),
    tableName: text("table_name").notNull(),
    rowId: uuid("row_id").notNull(),
    firstReadAt: timestamp("first_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("support_session_reads_key").on(t.sessionId, t.tableName, t.rowId)],
);
