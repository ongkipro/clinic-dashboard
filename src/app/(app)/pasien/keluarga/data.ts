// Keluarga / Wali data (19 §2.4 "Hubungan wali–anak; satu HP untuk beberapa pasien tanpa saling melihat", UX-29 ▸ Keluarga; HYG-NAV-2).
// FO only (nav row). Read-only over guardians ⨝ patients under RLS (identity readers, 0057); guardians are recorded at registration
// (patient_register) and are never edited (patients_rows_guard). Phones are masked; a guardian who is also a patient links to the profile.
// Patients sharing one phone are listed as a household WITHOUT showing each other's data beyond name and MRN to the FO.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { createHash, randomBytes } from "node:crypto";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { groupKey, type KeyedLink, maskPhone } from "./model";

export const FAMILY_READERS = ["fo_cashier"];
export type GuardianLink = KeyedLink & { createdAt: string };
export type KeluargaData = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "ok"; ctx: RenderedContext; links: GuardianLink[] };

// The group key leaves the server as a salted SHA-256 (per-request random salt): stable within one render, never the phone, name or patient id.
const opaque = (salt: Buffer, k: string) => createHash("sha256").update(salt).update(k).digest("base64url").slice(0, 22);

// The 200 newest links of the tenant (RLS binds the tenant); the page groups and filters them.
export async function loadKeluarga(): Promise<KeluargaData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !FAMILY_READERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  return withTenantContext(await appPool(), c, async (db) => {
    const r = await db.query(
      `select g.id, g.patient_id, p.full_name, p.mrn, g.guardian_name, g.relation, g.phone, g.guardian_patient_id, g.created_at
         from guardians g join patients p on p.tenant_id = g.tenant_id and p.id = g.patient_id
        order by g.created_at desc, g.id desc limit 200`);
    const salt = randomBytes(16);
    const links = r.rows.map((x) => {
      const raw = { id: x.id as string, patientId: x.patient_id, patientName: x.full_name, patientMrn: x.mrn, guardianName: x.guardian_name, relation: x.relation,
        phone: x.phone as string | null, guardianPatientId: x.guardian_patient_id };
      return { patientId: raw.patientId, patientName: raw.patientName, patientMrn: raw.patientMrn, guardianName: raw.guardianName, relation: raw.relation,
        phone: maskPhone(raw.phone), guardianPatientId: raw.guardianPatientId, group: opaque(salt, groupKey(raw)), createdAt: new Date(x.created_at).toISOString() };
    });
    return { kind: "ok", ctx: renderedContext(c), links };
  });
}
