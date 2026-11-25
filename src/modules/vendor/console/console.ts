// T-129 + HYG-024 (PR-87, 19 §3, ADR-7): Vendor Console readers & template writer.
// Every call runs on clinic_vendor and wraps late wall-clock authority refusals in withAuthorityRecheck
// so a rolled-back statement still commits a durable denied audit row (HYG-008b, SEC-16).
import type pg from "pg";
import { type ConsoleRefusal, withAuthorityRecheck } from "../authority";
import type { ConsoleCall } from "../tenants/tenants";

export type CodeCount = { code: string; count: number };

export type IntegrationTenantRow = {
  tenantId: string;
  legalName: string | null;
  state: string;
  whatsapp: { accountsCount: number; activeAccounts: number; failed24h: number; codes: CodeCount[] };
  satusehat: { queued: number; failed24h: number; codes: CodeCount[] };
  payments: { rejected24h: number; codes: CodeCount[] };
};

export type VendorActionRow = {
  id: string;
  at: string;
  actorRole: string | null;
  action: string;
  tenantId: string | null;
  tenantName: string | null;
  outcome: "success" | "denied";
  reasonCode: string | null;
  clientIp: string | null;
};

export type VendorProfileView = {
  legalName: string;
  nib: string;
  pseNumber: string;
  npwp: string;
  metaBusinessId: string;
  website: string;
  privacyUrl: string;
  supportEmail: string;
  supportPhone: string;
  placeholderFields: string[];
  storageLocations: { kind: string; provider: string; region: string; country: string }[];
  isPkp: boolean;
  pkpEffectiveFrom: string | null;
  residencyOpinionOutcome: string | null;
  residencyOpinionDate: string | null;
  residencyOpinionRef: string | null;
  updatedAt: string;
};

export type LegalTemplateKind = "kebijakan-privasi" | "syarat-ketentuan" | "kebijakan-pembatalan";
export type LegalTemplateRow = {
  id: string;
  kind: LegalTemplateKind;
  version: number;
  sha256: string;
  isActive: boolean;
  updatedAt: string;
  body: string;
};

export type FeatureFlagCatalogueRow = { key: string; label: string; description: string; tenderRef: string };
export type FeatureFlagAssignmentRow = { tenantId: string; flagKey: string; enabled: boolean; decisionRef: string; updatedAt: string };

type RawResult<T> = ({ ok: true } & T) | { ok: false; code: string; reason: string; count?: number; max?: number };
export type ConsoleAnswer<T> = { ok: true; data: T } | { ok: false; code: string; reason: string; count?: number; max?: number } | ConsoleRefusal;

function wrap<T>(raw: RawResult<T>): ConsoleAnswer<T> {
  if (raw.ok) return { ok: true, data: raw };
  return { ok: false, code: raw.code, reason: raw.reason, ...(raw.count !== undefined ? { count: raw.count, max: raw.max } : {}) };
}

export async function readIntegrations(
  db: pg.Pool | pg.ClientBase,
  c: ConsoleCall,
  tenantId: string | null = null,
): Promise<ConsoleAnswer<{ at: string; rows: IntegrationTenantRow[] }>> {
  return withAuthorityRecheck(db, c, "vendor_console_integrations", { tenant: tenantId }, async () => {
    const r = await db.query<{ r: RawResult<{ at: string; rows: IntegrationTenantRow[] }> }>(
      `select vendor_console_integrations($1, $2, $3::uuid) as r`,
      [c.token, c.ip, tenantId],
    );
    return wrap(r.rows[0].r);
  });
}

export async function listVendorActions(
  db: pg.Pool | pg.ClientBase,
  c: ConsoleCall,
  opts: { tenantId?: string | null; from?: string | null; to?: string | null; limit?: number } = {},
): Promise<ConsoleAnswer<{ rows: VendorActionRow[] }>> {
  const tenant = opts.tenantId ?? null;
  return withAuthorityRecheck(db, c, "vendor_console_actions_list", { tenant }, async () => {
    const r = await db.query<{ r: RawResult<{ rows: VendorActionRow[] }> }>(
      `select vendor_console_actions_list($1, $2, $3::uuid, $4::timestamptz, $5::timestamptz, $6::int) as r`,
      [c.token, c.ip, tenant, opts.from ?? null, opts.to ?? null, opts.limit ?? 100],
    );
    return wrap(r.rows[0].r);
  });
}

export async function readVendorProfile(
  db: pg.Pool | pg.ClientBase,
  c: ConsoleCall,
): Promise<ConsoleAnswer<{ profile: VendorProfileView; goLiveBlockers: string[] }>> {
  return withAuthorityRecheck(db, c, "vendor_console_profile", { tenant: null }, async () => {
    const r = await db.query<{ r: RawResult<{ profile: VendorProfileView; goLiveBlockers: string[] }> }>(
      `select vendor_console_profile($1, $2) as r`,
      [c.token, c.ip],
    );
    return wrap(r.rows[0].r);
  });
}

export async function listFeatureFlags(
  db: pg.Pool | pg.ClientBase,
  c: ConsoleCall,
): Promise<ConsoleAnswer<{ writesOpen: boolean; catalogue: FeatureFlagCatalogueRow[]; assignments: FeatureFlagAssignmentRow[] }>> {
  return withAuthorityRecheck(db, c, "vendor_console_flags", { tenant: null }, async () => {
    const r = await db.query<{
      r: RawResult<{ writesOpen: boolean; catalogue: FeatureFlagCatalogueRow[]; assignments: FeatureFlagAssignmentRow[] }>;
    }>(`select vendor_console_flags($1, $2) as r`, [c.token, c.ip]);
    return wrap(r.rows[0].r);
  });
}

export async function listLegalTemplates(
  db: pg.Pool | pg.ClientBase,
  c: ConsoleCall,
): Promise<ConsoleAnswer<{ rows: LegalTemplateRow[] }>> {
  return withAuthorityRecheck(db, c, "vendor_console_templates_list", { tenant: null }, async () => {
    const r = await db.query<{ r: RawResult<{ rows: LegalTemplateRow[] }> }>(
      `select vendor_console_templates_list($1, $2) as r`,
      [c.token, c.ip],
    );
    return wrap(r.rows[0].r);
  });
}

export async function saveLegalTemplate(
  db: pg.Pool | pg.ClientBase,
  c: ConsoleCall,
  input: { kind: string; body: string; activate?: boolean },
): Promise<ConsoleAnswer<{ id: string; kind: LegalTemplateKind; version: number; sha256: string; isActive: boolean }>> {
  return withAuthorityRecheck(db, c, "vendor_console_template_save", { tenant: null }, async () => {
    const r = await db.query<{
      r: RawResult<{ id: string; kind: LegalTemplateKind; version: number; sha256: string; isActive: boolean }>;
    }>(`select vendor_console_template_save($1, $2, $3, $4, $5) as r`, [
      c.token,
      c.ip,
      input.kind,
      input.body,
      Boolean(input.activate),
    ]);
    return wrap(r.rows[0].r);
  });
}

export async function isFeatureFlagOn(db: pg.ClientBase, key: string): Promise<boolean> {
  const r = await db.query<{ on: boolean }>(`select feature_flag_on($1) as on`, [key]);
  return Boolean(r.rows[0]?.on);
}
