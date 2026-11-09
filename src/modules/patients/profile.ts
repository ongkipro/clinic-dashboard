// Profil Pasien 360° (UX-29, PR-49, T-040): the role projection and the loader. The database decides
// who may read a patient (patient_get, patient_consents: the 13 identity roles, tenant-bound, unknown
// ids audited); this module decides which sections a role sees. Clinical sections are for clinical roles
// only (07:34, CLIN-021, 19:76 "*"); the non-clinical roles never get one. No migration: identity, guardians
// and consents come from T-037/T-038; the sections owned by later tasks say so instead of looking empty.
import type pg from "pg";
import type { Role } from "../../auth/policy";
import { CommandError } from "../../lib/command";
import { type ConsentChannel, type ConsentRow, type Outcome, patientConsents, type WithdrawRefusal, withdrawConsent } from "./consents/consents";
import { getPatient, type PatientView } from "./patients";

type ClinicalSection = "rekam-medis" | "foto" | "resep";
export type SectionId = "ringkasan" | "wali" | "persetujuan" | "kunjungan" | "paket-saldo" | ClinicalSection;
export const CLINICAL_SECTIONS: readonly ClinicalSection[] = ["rekam-medis", "foto", "resep"];

// The 13 identity readers (07:41; patient_get). Marketing, purchasing and auditor have no profile.
export const PROFILE_READERS: readonly Role[] = [
  "owner", "admin_pusat", "manager", "facility_head", "records_officer", "fo_cashier", "central_cs", "bc", "doctor", "nurse", "therapist", "pharmacist", "finance",
];
// Who sees each clinical section (07:44-50): examination and plan, intake photos, prescriptions.
const CLINICAL: Record<ClinicalSection, readonly Role[]> = {
  "rekam-medis": ["doctor", "facility_head", "records_officer", "nurse", "therapist"],
  foto: ["doctor", "facility_head", "records_officer", "bc", "nurse", "therapist"],
  resep: ["doctor", "pharmacist", "facility_head", "records_officer"],
};
// Consent recorders (consent_grant / consent_withdraw, DEC-052).
export const CONSENT_RECORDERS: readonly Role[] = ["fo_cashier", "central_cs", "bc", "doctor", "records_officer", "manager"];

const BASE: readonly SectionId[] = ["ringkasan", "wali", "persetujuan", "kunjungan", "paket-saldo"];

// The role projection: the sections a role sees, in page order; none for a role without a profile.
export function profileSections(role: Role): SectionId[] {
  if (!PROFILE_READERS.includes(role)) return [];
  return [...BASE, ...CLINICAL_SECTIONS.filter((s) => CLINICAL[s].includes(role))];
}

export type Profile = { patient: PatientView; consents: ConsentRow[]; sections: SectionId[]; canRecordConsent: boolean };

// One patient's profile for the acting role, or null when the role has no profile or the patient is
// not found (another tenant's or an unknown id). patient_get runs first, so the database decides and
// audits every refusal (role_forbidden, patient_not_found; plan r1 P1-1): let the transaction commit.
export async function loadProfile(db: pg.ClientBase, role: Role, id: string): Promise<Profile | null> {
  const patient = await getPatient(db, id);
  if (!patient) return null;
  const sections = profileSections(role);
  if (sections.length === 0) return null;
  return { patient, consents: await patientConsents(db, patient.id), sections, canRecordConsent: CONSENT_RECORDERS.includes(role) };
}

// Tarik Persetujuan from a profile: the consent must be this patient's (consent_withdraw takes only
// the consent id, so a crafted post on patient A's profile could name B's consent; plan r1 P1-2).
export async function withdrawFromProfile(
  db: pg.ClientBase, key: string, i: { patientId: string; consentId: string; channel: ConsentChannel; reason: string },
): Promise<Outcome<WithdrawRefusal>> {
  const own = (await patientConsents(db, i.patientId)).some((c) => c.id === i.consentId);
  if (!own) throw new CommandError("ERR_NOT_FOUND");
  return withdrawConsent(db, key, { consentId: i.consentId, channel: i.channel, reason: i.reason });
}
