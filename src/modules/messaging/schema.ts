// WhatsApp Business Platform (PR-27, TD-20, TD-21, DATA-38, DATA-57, W-01…W-09; T-089, migration 0104, DEC-101). Each tenant onboards its own
// WABA (Embedded Signup, incl. Coexistence; or a BSP fallback, W-09) through the Graph port — a mock adapter with recorded fixtures in tests and
// local runs (DEC-082: no live Meta call). The business token and each number's two-step PIN are sealed with the tenant DEK in the app
// (`waba.token`, `waba.pin`); the ciphertext is never granted to the app or the vendor operator. Numbers per branch or brand-wide (W-03), at most
// 2 before Meta business verification and 20 after (W-07), display names `Brand – Branch` (W-08). `waba_routes` (a platform table) maps a Meta
// phone number id to its tenant for the webhook intake (T-090).
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { branches, staff, tenants } from "../org/schema";

export const WABA_STATES = ["not_connected", "signup_started", "token_exchanged", "app_subscribed", "number_pending_registration", "number_registered",
  "display_name_pending", "active", "verification_required", "quality_restricted", "revoked"] as const;
export const WA_NUMBER_STATES = ["number_pending_registration", "number_registered", "display_name_pending", "active", "quality_restricted", "revoked"] as const;
export const ONBOARDING_CHANNELS = ["cloud_api", "bsp_fallback"] as const;
export const VERIFICATION_STATUSES = ["unverified", "pending", "verified"] as const;
export const TOKEN_KINDS = ["business_integration_system_user", "system_user", "bsp_api_key"] as const;
export const DISPLAY_NAME_STATUSES = ["none", "pending_review", "approved", "declined"] as const;
export const QUALITY_RATINGS = ["unknown", "green", "yellow", "red"] as const;
const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));
const KEY = (c: unknown) => sql`${c} ~ '^[A-Za-z0-9_.:-]{8,128}$'`;
const CIPHER = (c: unknown) => sql`${c} ~ '^v1\\.[1-9][0-9]{0,8}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'`;
const DEK = (c: unknown) => sql`${c} ~ '^dek:v[1-9][0-9]{0,8}$'`;

// One WABA per tenant (one non-revoked at a time); its onboarding state (TD-20) and the facts the Graph port reports.
export const wabaAccounts = pgTable(
  "waba_accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    state: text("state", { enum: WABA_STATES }).notNull().default("signup_started"),
    previousState: text("previous_state", { enum: WABA_STATES }),
    onboardingChannel: text("onboarding_channel", { enum: ONBOARDING_CHANNELS }).notNull(),
    bspProvider: text("bsp_provider"),
    metaWabaId: text("meta_waba_id"),
    metaBusinessId: text("meta_business_id"),
    businessVerificationStatus: text("business_verification_status", { enum: VERIFICATION_STATUSES }).notNull().default("unverified"),
    qualityRating: text("quality_rating", { enum: QUALITY_RATINGS }).notNull().default("unknown"),
    portfolioMessagingLimit: integer("portfolio_messaging_limit").notNull().default(250),
    appSubscribed: boolean("app_subscribed").notNull().default(false),
    startedBy: uuid("started_by").notNull(),
    startedAs: text("started_as").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "waba_accounts_started_by_fk", columns: [t.tenantId, t.startedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("waba_accounts_tenant_id_id_key").on(t.tenantId, t.id),
    unique("waba_accounts_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("waba_accounts_one_live").on(t.tenantId).where(sql`${t.state} <> 'revoked'`),
    uniqueIndex("waba_accounts_meta_id").on(t.metaWabaId).where(sql`${t.metaWabaId} is not null and ${t.state} <> 'revoked'`),
    check("waba_accounts_check", sql`${KEY(t.commandKey)} and ${t.state} in (${inList(WABA_STATES)})
      and (${t.previousState} is null or ${t.previousState} in (${inList(WABA_STATES)}))
      and ${t.onboardingChannel} in (${inList(ONBOARDING_CHANNELS)}) and ((${t.onboardingChannel} = 'bsp_fallback') = (${t.bspProvider} is not null))
      and (${t.bspProvider} is null or length(btrim(${t.bspProvider})) between 2 and 60)
      and (${t.metaWabaId} is null or ${t.metaWabaId} ~ '^[0-9]{5,32}$') and (${t.metaBusinessId} is null or ${t.metaBusinessId} ~ '^[0-9]{5,32}$')
      and ${t.businessVerificationStatus} in (${inList(VERIFICATION_STATUSES)}) and ${t.qualityRating} in (${inList(QUALITY_RATINGS)})
      and ${t.portfolioMessagingLimit} between 0 and 100000000 and ${t.startedAs} in ('owner','admin_pusat')
      and ((${t.state} = 'revoked') = (${t.revokedAt} is not null))
      and (${t.state} in ('not_connected','signup_started') or ${t.metaWabaId} is not null)`),
  ],
);

// The token vault (TD-21): the sealed business / system-user / BSP token of a WABA; one unrevoked per WABA. Never granted to the app or the
// vendor operator; read only by the server-side sender (later tasks) through a definer.
export const tokenVault = pgTable(
  "token_vault",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    wabaId: uuid("waba_id").notNull(),
    tokenKind: text("token_kind", { enum: TOKEN_KINDS }).notNull(),
    grantedScopes: text("granted_scopes").array().notNull().default(sql`'{}'::text[]`),
    encryptedToken: text("encrypted_token").notNull(),
    dekRef: text("dek_ref").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "token_vault_waba_fk", columns: [t.tenantId, t.wabaId], foreignColumns: [wabaAccounts.tenantId, wabaAccounts.id] }).onDelete("restrict"),
    unique("token_vault_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("token_vault_one_live").on(t.tenantId, t.wabaId).where(sql`${t.revokedAt} is null`),
    check("token_vault_check", sql`${t.tokenKind} in (${inList(TOKEN_KINDS)}) and ${CIPHER(t.encryptedToken)} and ${DEK(t.dekRef)}
      and cardinality(${t.grantedScopes}) <= 30 and ((${t.revokedAt} is null) = (${t.revokedReason} is null))
      and (${t.revokedReason} is null or ${t.revokedReason} ~ '^[a-z][a-z_]{1,40}$')`),
  ],
);

// A number of the WABA: per branch or brand-wide (W-03); its registration (sealed two-step PIN), display name (W-08), quality; Coexistence (W-04).
export const waNumbers = pgTable(
  "wa_numbers",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    wabaId: uuid("waba_id").notNull(),
    branchId: uuid("branch_id"),
    phoneNumber: text("phone_number").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    displayName: text("display_name").notNull(),
    state: text("state", { enum: WA_NUMBER_STATES }).notNull().default("number_pending_registration"),
    displayNameStatus: text("display_name_status", { enum: DISPLAY_NAME_STATUSES }).notNull().default("none"),
    qualityRating: text("quality_rating", { enum: QUALITY_RATINGS }).notNull().default("unknown"),
    isCoexistence: boolean("is_coexistence").notNull().default(false),
    historySyncEnabled: boolean("history_sync_enabled").notNull().default(false),
    registrationPinEnc: text("registration_pin_enc").notNull(),
    pinDekRef: text("pin_dek_ref").notNull(),
    addedBy: uuid("added_by").notNull(),
    addedAs: text("added_as").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "wa_numbers_waba_fk", columns: [t.tenantId, t.wabaId], foreignColumns: [wabaAccounts.tenantId, wabaAccounts.id] }).onDelete("restrict"),
    foreignKey({ name: "wa_numbers_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ name: "wa_numbers_added_by_fk", columns: [t.tenantId, t.addedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    unique("wa_numbers_tenant_id_id_key").on(t.tenantId, t.id),
    unique("wa_numbers_command_key").on(t.tenantId, t.commandKey),
    uniqueIndex("wa_numbers_phone_id_live").on(t.phoneNumberId).where(sql`${t.state} <> 'revoked'`),
    uniqueIndex("wa_numbers_phone_live").on(t.phoneNumber).where(sql`${t.state} <> 'revoked'`),
    uniqueIndex("wa_numbers_branch_live").on(t.tenantId, t.branchId).where(sql`${t.branchId} is not null and ${t.state} <> 'revoked'`),
    uniqueIndex("wa_numbers_brand_live").on(t.tenantId, t.wabaId).where(sql`${t.branchId} is null and ${t.state} <> 'revoked'`),
    check("wa_numbers_check", sql`${KEY(t.commandKey)} and ${t.state} in (${inList(WA_NUMBER_STATES)})
      and ${t.displayNameStatus} in (${inList(DISPLAY_NAME_STATUSES)}) and ${t.qualityRating} in (${inList(QUALITY_RATINGS)})
      and ${t.phoneNumber} ~ '^\\+[1-9][0-9]{7,14}$' and ${t.phoneNumberId} ~ '^[0-9]{5,32}$' and length(btrim(${t.displayName})) between 3 and 120
      and (not ${t.historySyncEnabled} or ${t.isCoexistence}) and ${CIPHER(t.registrationPinEnc)} and ${DEK(t.pinDekRef)}
      and ${t.addedAs} in ('owner','admin_pusat') and ((${t.state} = 'revoked') = (${t.revokedAt} is not null))
      and ((${t.state} = 'number_pending_registration') = (${t.registeredAt} is null))`),
  ],
);

// Platform routing (DATA-57, TEN-9): a Meta phone number id → its tenant, WABA, number and branch; unique across tenants. Written by the
// registration definer; read only by the unbound webhook intake (T-090) through `waba_route_resolve`.
export const wabaRoutes = pgTable(
  "waba_routes",
  {
    phoneNumberId: text("phone_number_id").notNull(),
    metaWabaId: text("meta_waba_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    wabaId: uuid("waba_id").notNull(),
    waNumberId: uuid("wa_number_id").notNull(),
    branchId: uuid("branch_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: "waba_routes_pkey", columns: [t.phoneNumberId] }),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ name: "waba_routes_waba_fk", columns: [t.tenantId, t.wabaId], foreignColumns: [wabaAccounts.tenantId, wabaAccounts.id] }).onDelete("restrict"),
    foreignKey({ name: "waba_routes_number_fk", columns: [t.tenantId, t.waNumberId], foreignColumns: [waNumbers.tenantId, waNumbers.id] }).onDelete("restrict"),
    foreignKey({ name: "waba_routes_branch_fk", columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    check("waba_routes_check", sql`${t.phoneNumberId} ~ '^[0-9]{5,32}$' and ${t.metaWabaId} ~ '^[0-9]{5,32}$'
      and (${t.active} = (${t.deactivatedAt} is null))`),
  ],
);

// ── T-090 (PR-28, TD-22, TD-24, TD-25 part, W-05, W-10, DATA-38; migration 0105, plan Argon 92626f3c REVISE adopted / 3688a6e2 APPROVE) ──
// The Pesan inbox: raw webhook receipts (platform until routed), conversations per number and contact, messages (bodies sealed with the tenant
// DEK, `message.body`; never a plaintext column, W-10), and the tenant's WhatsApp templates. Media (TD-23) and costs (OBS-5) are T-094.
export const RECEIPT_KINDS = ["message", "status", "unknown"] as const;
export const RECEIPT_STATES = ["received", "processed", "held_out_of_order", "duplicate", "rejected_signature", "dropped_unknown_route"] as const;
export const CONVERSATION_STATES = ["open", "closed"] as const;
export const MESSAGE_DIRECTIONS = ["in", "out"] as const;
export const MESSAGE_KINDS = ["text", "template", "media"] as const;
export const MESSAGE_STATUSES = ["received", "queued", "sent", "delivered", "read", "failed"] as const;
export const SENT_VIA = ["cloud_api", "business_app"] as const;
export const TEMPLATE_CATEGORIES = ["utility", "marketing", "authentication"] as const;
export const TEMPLATE_STATUSES = ["draft", "pending", "approved", "rejected"] as const;
const SHA = (c: unknown) => sql`${c} ~ '^[0-9a-f]{64}$'`;

// Every Meta webhook delivery (TD-22): one verified live receipt per provider event; bad signatures and unknown routes are kept as non-personal
// metadata only (tenant NULL, no payload). A routed, verified receipt keeps its raw event sealed with the tenant DEK (`message.webhook_raw`).
export const metaWebhookReceipts = pgTable(
  "meta_webhook_receipts",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    providerEventId: text("provider_event_id").notNull(),
    kind: text("kind", { enum: RECEIPT_KINDS }).notNull(),
    phoneNumberId: text("phone_number_id"),
    tenantId: uuid("tenant_id"),
    signatureOk: boolean("signature_ok").notNull(),
    state: text("state", { enum: RECEIPT_STATES }).notNull(),
    bodySha256: text("body_sha256").notNull(),
    rawPayloadEnc: text("raw_payload_enc"),
    payloadDekRef: text("payload_dek_ref"),
    targetMessageId: text("target_message_id"),
    observedStatus: text("observed_status"),
    statusAt: timestamp("status_at", { withTimezone: true }),
    errorCode: text("error_code"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    uniqueIndex("meta_webhook_receipts_verified_key").on(t.providerEventId, t.kind)
      .where(sql`${t.signatureOk} and ${t.state} in ('received','processed','held_out_of_order')`),
    check("meta_webhook_receipts_check", sql`length(${t.providerEventId}) between 1 and 200 and ${SHA(t.bodySha256)}
      and ${t.state} in (${inList(RECEIPT_STATES)}) and ${t.kind} in (${inList(RECEIPT_KINDS)})
      and (${t.signatureOk} or ${t.state} = 'rejected_signature')
      and ((${t.rawPayloadEnc} is null) = (${t.payloadDekRef} is null))
      and (${t.rawPayloadEnc} is null or (${t.tenantId} is not null and ${CIPHER(t.rawPayloadEnc)} and ${DEK(t.payloadDekRef)}))
      and (${t.state} not in ('rejected_signature','dropped_unknown_route') or ${t.rawPayloadEnc} is null)
      and (${t.observedStatus} is null or ${t.observedStatus} in ('sent','delivered','read','failed'))
      and (${t.errorCode} is null or ${t.errorCode} ~ '^[a-z][a-z_]{1,60}$')`),
  ],
);

// A conversation: one live thread per number and contact (W-03 branch or brand-wide, routed to a branch later). The 24 h customer service
// window (TD-25) follows the last inbound message and never moves back. The contact name is sealed (`message.contact`).
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    wabaId: uuid("waba_id").notNull(),
    waNumberId: uuid("wa_number_id").notNull(),
    branchId: uuid("branch_id"),
    contactWaId: text("contact_wa_id").notNull(),
    contactNameEnc: text("contact_name_enc"),
    contactNameDekRef: text("contact_name_dek_ref"),
    patientId: uuid("patient_id"),
    assigneeStaffId: uuid("assignee_staff_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    state: text("state", { enum: CONVERSATION_STATES }).notNull().default("open"),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    windowExpiresAt: timestamp("window_expires_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("conversations_tenant_id_id_key").on(t.tenantId, t.id),
    unique("conversations_contact_key").on(t.tenantId, t.waNumberId, t.contactWaId),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.wabaId], foreignColumns: [wabaAccounts.tenantId, wabaAccounts.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.waNumberId], foreignColumns: [waNumbers.tenantId, waNumbers.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.assigneeStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("conversations_check", sql`${t.contactWaId} ~ '^[1-9][0-9]{7,14}$' and ${t.state} in (${inList(CONVERSATION_STATES)})
      and ((${t.contactNameEnc} is null) = (${t.contactNameDekRef} is null))
      and (${t.contactNameEnc} is null or (${CIPHER(t.contactNameEnc)} and ${DEK(t.contactNameDekRef)}))
      and ((${t.lastInboundAt} is null) = (${t.windowExpiresAt} is null))
      and (${t.lastInboundAt} is null or ${t.windowExpiresAt} = ${t.lastInboundAt} + interval '24 hours')
      and ((${t.assigneeStaffId} is null) = (${t.assignedAt} is null))
      and cardinality(${t.labels}) <= 10`),
  ],
);

// The tenant's WhatsApp templates (synced from the port or saved neutral drafts; W-05). Only `approved` is sendable.
export const waTemplates = pgTable(
  "wa_templates",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    wabaId: uuid("waba_id").notNull(),
    name: text("name").notNull(),
    language: text("language").notNull().default("id"),
    category: text("category", { enum: TEMPLATE_CATEGORIES }).notNull(),
    status: text("status", { enum: TEMPLATE_STATUSES }).notNull().default("draft"),
    body: text("body").notNull(),
    paramCount: integer("param_count").notNull().default(0),
    savedBy: uuid("saved_by"),
    savedAs: text("saved_as"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    commandKey: text("command_key").notNull(),
  },
  (t) => [
    unique("wa_templates_tenant_id_id_key").on(t.tenantId, t.id),
    unique("wa_templates_command_key").on(t.tenantId, t.commandKey),
    unique("wa_templates_name_key").on(t.tenantId, t.wabaId, t.name, t.language),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.wabaId], foreignColumns: [wabaAccounts.tenantId, wabaAccounts.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.savedBy], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("wa_templates_check", sql`${KEY(t.commandKey)} and ${t.name} ~ '^[a-z][a-z0-9_]{1,127}$' and ${t.language} ~ '^[a-z]{2}(_[A-Z]{2})?$'
      and ${t.category} in (${inList(TEMPLATE_CATEGORIES)}) and ${t.status} in (${inList(TEMPLATE_STATUSES)})
      and length(btrim(${t.body})) between 1 and 1024 and ${t.paramCount} between 0 and 10
      and ((${t.savedBy} is null) = (${t.savedAs} is null))`),
  ],
);

// A message: inbound or outbound (staff through the port, or a Coexistence echo from the Business app, TD-24). The body is sealed
// (`message.body`); a media message keeps Meta's opaque media id (never a URL, TD-23) until T-094 stores the object. Statuses advance only.
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    sentVia: text("sent_via", { enum: SENT_VIA }).notNull().default("cloud_api"),
    kind: text("kind", { enum: MESSAGE_KINDS }).notNull(),
    bodyEnc: text("body_enc"),
    bodyDekRef: text("body_dek_ref"),
    templateId: uuid("template_id"),
    templateCategory: text("template_category", { enum: TEMPLATE_CATEGORIES }),
    mediaMetaId: text("media_meta_id"),
    mediaMimeType: text("media_mime_type"),
    providerMessageId: text("provider_message_id"),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull(),
    providerAt: timestamp("provider_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    authorStaffId: uuid("author_staff_id"),
    authorAs: text("author_as"),
    commandKey: text("command_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique("messages_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("messages_provider_id").on(t.providerMessageId).where(sql`${t.providerMessageId} is not null`),
    uniqueIndex("messages_command_key").on(t.tenantId, t.commandKey).where(sql`${t.commandKey} is not null`),
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.conversationId], foreignColumns: [conversations.tenantId, conversations.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.templateId], foreignColumns: [waTemplates.tenantId, waTemplates.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.tenantId, t.authorStaffId], foreignColumns: [staff.tenantId, staff.id] }).onDelete("restrict"),
    check("messages_check", sql`${t.direction} in (${inList(MESSAGE_DIRECTIONS)}) and ${t.kind} in (${inList(MESSAGE_KINDS)})
      and ${t.status} in (${inList(MESSAGE_STATUSES)}) and ${t.sentVia} in (${inList(SENT_VIA)})
      and ((${t.bodyEnc} is null) = (${t.bodyDekRef} is null)) and (${t.bodyEnc} is null or (${CIPHER(t.bodyEnc)} and ${DEK(t.bodyDekRef)}))
      and ((${t.kind} = 'template') = (${t.templateId} is not null)) and ((${t.templateId} is null) = (${t.templateCategory} is null))
      and ((${t.kind} = 'media') = (${t.mediaMetaId} is not null)) and (${t.mediaMetaId} is null or ${t.mediaMetaId} !~* '^https?://')
      and (${t.kind} <> 'text' or ${t.bodyEnc} is not null)
      and ((${t.direction} = 'in') = (${t.status} = 'received')) and (${t.direction} = 'out' or ${t.sentVia} = 'cloud_api')
      and (${t.direction} = 'in' or ${t.sentVia} = 'business_app' or ${t.authorStaffId} is not null)
      and ((${t.authorStaffId} is null) = (${t.authorAs} is null))
      and (${t.status} in ('received','queued') or ${t.providerMessageId} is not null)
      and (${t.commandKey} is null or ${KEY(t.commandKey)})`),
  ],
);
