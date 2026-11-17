// FHIR builders (T-102 plan §2; Q-19 rows, docs/tasks/T-102.md). Only ids and codes: the Encounter (class AMB, statusHistory arrived →
// in-progress → finished, the doctor as ATND, the consultation room's Location, the branch's Organization, the confirmed Conditions as its
// diagnoses) and one Condition per ICD-10 code (category encounter-diagnosis). Identifiers follow the guide's sys-ids systems with stable
// local values, so a lost create can be found again (plan §5). Times are sent in UTC (+00:00) as the guide asks.
import type { Fhir } from "./port";

export const utc = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, "+00:00");
export const encounterSystem = (org: string) => `http://sys-ids.kemkes.go.id/encounter/${org}`;
export const conditionSystem = (org: string) => `http://sys-ids.kemkes.go.id/condition/${org}`;
export const conditionValue = (visitId: string, code: string) => `${visitId}:${code}`;

export type EncounterInput = { org: string; visitId: string; patientIhs: string; practitionerIhs: string; locationId: string;
  arrivedAt: string; inProgressAt: string; finishedAt: string; diagnoses: string[] };
export function encounter(i: EncounterInput): Fhir {
  const [a, p, f] = [utc(i.arrivedAt), utc(i.inProgressAt), utc(i.finishedAt)];
  return {
    resourceType: "Encounter",
    identifier: [{ system: encounterSystem(i.org), use: "official", value: i.visitId }],
    status: "finished",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
    subject: { reference: `Patient/${i.patientIhs}` },
    participant: [{ type: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", code: "ATND", display: "attender" }] }],
      individual: { reference: `Practitioner/${i.practitionerIhs}` } }],
    period: { start: a, end: f },
    location: [{ location: { reference: `Location/${i.locationId}` } }],
    ...(i.diagnoses.length ? { diagnosis: i.diagnoses.map((id, n) => ({ condition: { reference: `Condition/${id}` },
      use: { coding: [{ system: "https://www.hl7.org/fhir/Codesystem-diagnosis-role", code: "DD", display: "Discharge diagnosis" }] }, rank: n + 1 })) } : {}),
    statusHistory: [
      { status: "arrived", period: { start: a, end: p } },
      { status: "in-progress", period: { start: p, end: f } },
      { status: "finished", period: { start: f, end: f } },
    ],
    serviceProvider: { reference: `Organization/${i.org}` },
  };
}

export type ConditionInput = { org: string; visitId: string; code: string; patientIhs: string; encounterId: string };
export function condition(i: ConditionInput): Fhir {
  return {
    resourceType: "Condition",
    identifier: [{ system: conditionSystem(i.org), use: "official", value: conditionValue(i.visitId, i.code) }],
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active", display: "Active" }] },
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "encounter-diagnosis", display: "Encounter Diagnosis" }] }],
    code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: i.code }] },
    subject: { reference: `Patient/${i.patientIhs}` },
    encounter: { reference: `Encounter/${i.encounterId}` },
  };
}

// The exact stable identifier of a remote resource (reconciliation matches only on this, plan §5).
export const hasIdentifier = (r: Fhir, system: string, value: string) =>
  Array.isArray(r.identifier) && (r.identifier as { system?: string; value?: string }[]).some((x) => x.system === system && x.value === value);
// The Encounter's diagnosis references as sent (read-back comparison for an uncertain update, plan §5).
export const diagnosisRefs = (r: Fhir) =>
  ((r.diagnosis as { condition?: { reference?: string } }[] | undefined) ?? []).map((d) => (d.condition?.reference ?? "").replace(/^Condition\//, ""));
