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

// ── Increment 2 (plan r4 §2; addendum docs/tasks/T-102.md; official resource pages, Q-19 "Increment 2 additions") ───────────────────────
export const observationSystem = (org: string) => `http://sys-ids.kemkes.go.id/observation/${org}`;
export const procedureSystem = (org: string) => `http://sys-ids.kemkes.go.id/procedure/${org}`;
export const medicationSystem = (org: string) => `http://sys-ids.kemkes.go.id/medication/${org}`;
export const prescriptionSystem = (org: string) => `http://sys-ids.kemkes.go.id/prescription/${org}`;
export const prescriptionItemSystem = (org: string) => `http://sys-ids.kemkes.go.id/prescription-item/${org}`;
export const dispenseSystem = (org: string) => `http://sys-ids.kemkes.go.id/medicationdispense/${org}`;
const ident = (system: string, value: string) => [{ system, use: "official", value }];

export type ObservationInput = { org: string; visitId: string; field: string; code: string; display: string; value: number; unit: string; ucum: string;
  patientIhs: string; practitionerIhs: string; encounterId: string; effective: string };
export function observation(i: ObservationInput): Fhir {
  return {
    resourceType: "Observation",
    identifier: ident(observationSystem(i.org), `${i.visitId}:${i.field}`),
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }] }],
    code: { coding: [{ system: "http://loinc.org", code: i.code, display: i.display }] },
    subject: { reference: `Patient/${i.patientIhs}` },
    encounter: { reference: `Encounter/${i.encounterId}` },
    performer: [{ reference: `Practitioner/${i.practitionerIhs}` }],
    effectiveDateTime: utc(i.effective),
    valueQuantity: { value: i.value, unit: i.unit, system: "http://unitsofmeasure.org", code: i.ucum },
  };
}

export type ProcedureInput = { org: string; executionId: string; code: string; display: string; patientIhs: string; practitionerIhs: string;
  encounterId: string; start: string; end: string };
export function procedure(i: ProcedureInput): Fhir {
  return {
    resourceType: "Procedure",
    identifier: ident(procedureSystem(i.org), i.executionId),
    status: "completed",
    code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-9-cm", code: i.code, display: i.display }] },
    subject: { reference: `Patient/${i.patientIhs}` },
    encounter: { reference: `Encounter/${i.encounterId}` },
    performedPeriod: { start: utc(i.start), end: utc(i.end) },
    performer: [{ actor: { reference: `Practitioner/${i.practitionerIhs}` } }],
  };
}

// Non-compound (NC) only: racikan is out of T-102 (plan §2). Medication.code (KFA) is mandatory for non-racikan.
export type MedicationInput = { org: string; itemId: string; kfa: string };
export function medication(i: MedicationInput): Fhir {
  return {
    resourceType: "Medication",
    identifier: ident(medicationSystem(i.org), i.itemId),
    code: { coding: [{ system: "http://sys-ids.kemkes.go.id/kfa", code: i.kfa }] },
    status: "active",
    extension: [{ url: "https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationType",
      valueCodeableConcept: { coding: [{ system: "https://terminology.kemkes.go.id/CodeSystem/medication-type", code: "NC", display: "Non-compound" }] } }],
  };
}

export type MedicationRequestInput = { org: string; prescriptionId: string; itemId: string; medicationId: string; patientIhs: string; encounterId: string;
  practitionerIhs: string; authoredOn: string; signa: string; quantity: number };
export function medicationRequest(i: MedicationRequestInput): Fhir {
  return {
    resourceType: "MedicationRequest",
    identifier: [...ident(prescriptionSystem(i.org), i.prescriptionId), ...ident(prescriptionItemSystem(i.org), i.itemId)],
    status: "completed",
    intent: "order",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/medicationrequest-category", code: "outpatient", display: "Outpatient" }] }],
    medicationReference: { reference: `Medication/${i.medicationId}` },
    subject: { reference: `Patient/${i.patientIhs}` },
    encounter: { reference: `Encounter/${i.encounterId}` },
    authoredOn: utc(i.authoredOn),
    requester: { reference: `Practitioner/${i.practitionerIhs}` },
    dosageInstruction: [{ text: i.signa }],
    dispenseRequest: { quantity: { value: i.quantity } },
    substitution: { allowedBoolean: false },
  };
}

export type MedicationDispenseInput = { org: string; dispensingId: string; medicationId: string; requestId: string; patientIhs: string; encounterId: string;
  practitionerIhs: string; handedOver: string; quantity: number };
export function medicationDispense(i: MedicationDispenseInput): Fhir {
  return {
    resourceType: "MedicationDispense",
    identifier: ident(dispenseSystem(i.org), i.dispensingId),
    status: "completed",
    category: { coding: [{ system: "http://terminology.hl7.org/fhir/CodeSystem/medicationdispense-category", code: "outpatient", display: "Outpatient" }] },
    medicationReference: { reference: `Medication/${i.medicationId}` },
    subject: { reference: `Patient/${i.patientIhs}` },
    context: { reference: `Encounter/${i.encounterId}` },
    performer: [{ actor: { reference: `Practitioner/${i.practitionerIhs}` } }],
    authorizingPrescription: [{ reference: `MedicationRequest/${i.requestId}` }],
    quantity: { value: i.quantity },
    whenHandedOver: utc(i.handedOver),
    substitution: { wasSubstituted: false },
  };
}
