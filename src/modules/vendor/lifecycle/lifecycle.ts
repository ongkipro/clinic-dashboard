// Tenant lifecycle (PR-56, TEN-12, T-022). Transitions run in the database
// (tenant_lifecycle_transition); this module is the executing worker's side and the
// capability check later tasks call before an action.
//
// Maker-checker edges (suspension, reactivation, exit, closure) are applied by a worker on
// a clinic_executor login; the database consumes the request and writes the transition in
// one call. Onboarding steps are vendor console actions bound to the vendor session
// (vendor_console_tenant_advance; the console screens arrive with T-023 and T-024).
import type pg from "pg";
import { CommandError } from "../../../lib/command";
import { CONSUME_REFUSALS, recordConsumeRefusal, VendorStaffError } from "../staff/staff";

export type LifecycleState = "provisioning" | "onboarding" | "live" | "suspended" | "exit" | "closed";

export type LifecycleRequestKind = "suspension" | "reactivation" | "exit" | "closure";

// Apply an approved suspension / reactivation / exit / closure request for a tenant, on a
// clinic_executor pool. The database consumes the request and applies its edge with the
// approved reason in one call (tenant_lifecycle_apply_request); a refused request is
// recorded after the rollback (T-020). `service` names the worker (audited, anchored to its
// login).
export async function applyLifecycleRequest(
  executor: pg.Pool, requestId: string, kind: LifecycleRequestKind, tenantId: string, service: string,
): Promise<LifecycleState> {
  const tx = await executor.connect();
  try {
    await tx.query("begin");
    try {
      const s = (await tx.query<{ s: LifecycleState }>(`select tenant_lifecycle_apply_request($1, $2, $3, $4) as s`, [requestId, kind, tenantId, service])).rows[0].s;
      await tx.query("commit");
      return s;
    } catch (e) {
      await tx.query("rollback");
      const m = /^ERR_VERSION_CONFLICT: .*\((\w+)\)$/.exec((e as { message?: string }).message ?? "");
      if (m && CONSUME_REFUSALS.has(m[1])) {
        await recordConsumeRefusal(tx, requestId, kind, tenantId, service, m[1]);
        throw new VendorStaffError("ERR_VERSION_CONFLICT", m[1]);
      }
      throw e;
    }
  } finally {
    tx.release();
  }
}

// Capabilities a tenant keeps or loses with its state (PR-56, TEN-12).
export const CAPABILITIES = [
  "new_booking", "public_site", "marketing_message",
  "existing_appointment", "cashier", "care_message", "clinical_read", "clinical_export", "purpose_read",
  "satusehat_outbox", "record_correction", "patient_copy", "data_request", "configuration",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Inside withTenantContext: refuses with ERR_TENANT_SUSPENDED when the bound tenant's state
// does not allow the capability (unknown state or capability: refused).
export async function assertTenantCapability(db: pg.ClientBase, capability: Capability): Promise<void> {
  const ok = (await db.query<{ ok: boolean }>(`select tenant_capability($1) as ok`, [capability])).rows[0].ok;
  if (!ok) throw new CommandError("ERR_TENANT_SUSPENDED");
}

export async function tenantLifecycleStatus(db: pg.ClientBase): Promise<{ state: LifecycleState; since: Date | null; reason: string | null } | null> {
  const r = (await db.query<{ state: LifecycleState; since: Date | null; reason: string | null }>(`select * from tenant_lifecycle_status()`)).rows[0];
  return r ?? null;
}
