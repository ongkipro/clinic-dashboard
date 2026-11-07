// Test helper (T-027): clears every PR-59 go-live blocker of one tenant, for tests whose subject is
// not the gate itself (lifecycle edges, the onboarding grant). The gate is tested in
// tests/vendor/checklist.test.ts. Through the real paths only: the clinic Owner approves the clinical
// go-live evidence, the vendor profile is completed by the database owner (as profile.test.ts does),
// and every checklist item is set by the database owner on the platform table.
import type pg from "pg";
import { withTenantContext } from "../../src/db/rls/context";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { resolveContext } from "../../src/modules/org/identity";

const CLINICAL = ["clinical_authority_matrix", "sop_downtime", "sop_incident", "sop_waste", "appointment_responsible_person", "appointment_pharmacist"];

// The vendor profile without placeholders and with Indonesian storage (the maker-checker part of
// vendor_go_live_blockers stays with each test's vendor staff).
export async function completeVendorProfile(admin: pg.ClientBase): Promise<void> {
  await admin.query(
    `update vendor_profile set legal_name = 'PT Sintetis Teknologi Klinik', nib = '1234567890123', pse_number = '000123.01/DJAI.PSE/11/2026',
       npwp = '0123456789012345', meta_business_id = '123456789012345', website = 'https://vendor-sintetis.example',
       privacy_url = 'https://vendor-sintetis.example/privasi', support_email = 'dukungan@vendor-sintetis.example', support_phone = '+6281234567890',
       placeholder_fields = '{}', storage_locations = $1::jsonb where id = 1`,
    [JSON.stringify(["database", "object_storage", "backups", "logs", "error_tracking"].map((kind) => ({ kind, provider: "Penyedia Lokal", region: "Jakarta", country: "ID" })))]);
}

// For a tenant in onboarding: every checklist item done (integrations not applicable) and the
// clinical go-live evidence approved by the clinic's Owner (`ownerAcc`). When the clinic has another
// clinical decider (a facility head, `uploader`), that person uploads: the uploader never decides
// their own file while someone else can (0048 evidence_decide, DEC-031 D3).
export async function clearGoLiveBlockers(
  admin: pg.ClientBase, app: pg.Pool, tenantId: string, ownerAcc: string,
  uploader?: { acc: string; role: "facility_head"; branchId: string },
): Promise<void> {
  await admin.query(
    `update onboarding_checklist_items
        set status = CASE WHEN item IN ('payment_port','waba','satusehat') THEN 'not_applicable' ELSE 'done' END,
            note = CASE WHEN item IN ('payment_port','waba','satusehat') THEN 'Tidak dipakai dalam uji' END
      where tenant_id = $1`, [tenantId]);
  const ctx = await resolveContext(app, ownerAcc, { tenantId, actingRole: "owner" });
  const up = uploader ? await resolveContext(app, uploader.acc, { tenantId, actingRole: uploader.role, activeBranchId: uploader.branchId }) : ctx;
  // The facility head handles clinical-area items only (compliance_may_act); the two operations SOPs
  // are the Owner's (who then approves them as the only operations decider, D3 self-approval).
  const OPERATIONS = ["sop_downtime", "sop_incident"];
  for (const key of CLINICAL) {
    const f = await withTenantContext(app, OPERATIONS.includes(key) ? ctx : up, (db) =>
      uploadEvidence(db, { obligationKey: key, fileName: `${key}.pdf`, content: Buffer.from(`%PDF-1.7\n${key} ${tenantId}\n%%EOF\n`), expertName: "Konsultan Sintetis", documentDate: "2026-10-01" }));
    await withTenantContext(app, ctx, async (db) => {
      const item = (await db.query(`select item_id from evidence_files where id = $1`, [f.fileId])).rows[0].item_id as string;
      await decideEvidence(db, item, f.fileId, "approved");
    });
  }
}
