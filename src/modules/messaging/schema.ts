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
