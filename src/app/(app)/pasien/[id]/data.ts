// Profil Pasien data (UX-29, PR-49, T-040): one request in the active context. The database decides who
// reads the patient (patient_get: 13 identity roles, tenant-bound, unknown ids audited); the module's
// role projection decides the sections. Current consent texts are loaded for recorders only.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { currentText } from "../../../../modules/patients/consents/consents";
import { loadProfile, type Profile, PROFILE_READERS } from "../../../../modules/patients/profile";

export type Texts = Record<string, { id: string; version: number; body: string } | null>;
export type ProfileData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "ok"; profile: Profile; texts: Texts; branchName: string; age: number; ctx: RenderedContext };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRANTABLE = ["care_notice", "clinical_photo", "marketing_wa", "publication"] as const;

export async function loadPatientProfile(id: string): Promise<ProfileData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !PROFILE_READERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  if (!UUID.test(id)) return { kind: "not-found" };
  // patient_get audits a not-found in the caller's chain: the transaction commits either way.
  return withTenantContext(await appPool(), c, async (db) => {
    const profile = await loadProfile(db, c.actingRole, id);
    if (!profile) return { kind: "not-found" as const };
    const texts: Texts = {};
    if (profile.canRecordConsent) {
      for (const p of GRANTABLE) {
        const t = await currentText(db, p);
        texts[p] = t ? { id: t.id, version: t.version, body: t.body } : null;
      }
    }
    const r = (await db.query(
      `select b.name, extract(year from age((clock_timestamp() at time zone b.timezone)::date, $2::date))::int as age from branches b where b.id = $1`,
      [profile.patient.registeredBranchId, profile.patient.birthDate],
    )).rows[0];
    return { kind: "ok" as const, profile, texts, branchName: (r?.name as string) ?? "—", age: (r?.age as number) ?? 0, ctx: renderedContext(c) };
  });
}
