// The SATUSEHAT port (PR-35, TD-30–TD-33; T-102, DEC-113). Calls follow the official platform docs (Q-19, docs/tasks/T-102.md): OAuth2
// client_credentials token; Patient and Practitioner search by NIK; create (POST), full update (PUT), read by id (GET <Type>/:id, "Detail
// Data") and the documented searches (Encounter?subject, Condition?encounter). The adapter in tests and local runs is the mock (mock.ts,
// guide-shaped synthetic fixtures — not recorded responses). No live adapter exists yet (planned for the owner-gated sandbox step, TD-34);
// external connectivity is unverified.
export type FhirType = "Encounter" | "Condition" | "Observation" | "Procedure" | "Medication" | "MedicationRequest" | "MedicationDispense";
export type Fhir = Record<string, unknown> & { resourceType: FhirType; id?: string };
export type Auth = { environment: "sandbox" | "production"; organizationId: string; clientId: string; clientSecret: string };
export type Token = { accessToken: string; expiresInSec: number; issuedAtMs: number };

// A remote call's outcome as the worker records it: ok, an HTTP error class, or no answer (timeout = no response before the client abort;
// lost = the response could not be read). A timeout or lost write may still have committed remotely.
export type CallResult<T> =
  | { kind: "ok"; status: number; value: T }
  | { kind: "http_4xx"; status: number; code: string; path: string | null; body: Record<string, unknown> }
  | { kind: "http_5xx"; status: number }
  | { kind: "timeout" }
  | { kind: "lost" };

export type PatientHit = { ihs: string; name: string; birthDate: string; gender: "male" | "female" };
export type Bundle = { total: number; entries: Fhir[]; hasNext: boolean };

export interface SatusehatPort {
  token(auth: Auth): Promise<Token>;
  searchPatientByNik(token: string, env: Auth["environment"], nik: string): Promise<CallResult<PatientHit[]>>;
  searchPractitionerByNik(token: string, env: Auth["environment"], nik: string): Promise<CallResult<string[]>>;
  create(token: string, env: Auth["environment"], body: Fhir): Promise<CallResult<{ id: string; versionId: string | null }>>;
  update(token: string, env: Auth["environment"], id: string, body: Fhir): Promise<CallResult<{ id: string; versionId: string | null }>>;
  read(token: string, env: Auth["environment"], type: FhirType, id: string): Promise<CallResult<Fhir>>;
  search(token: string, env: Auth["environment"], type: FhirType, params: Record<string, string>): Promise<CallResult<Bundle>>;
}
