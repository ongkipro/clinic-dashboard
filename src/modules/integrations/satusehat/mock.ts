// The mock SATUSEHAT port (T-102): an in-memory remote store with guide-shaped synthetic responses (fixtures.ts) — NOT recorded sandbox
// responses (external connectivity is unverified until the owner-gated sandbox step). Tests script outcomes per call kind: an error, a
// timeout or lost response that still commits (now or later — a delayed commit), so reconciliation and the uncertainty barrier can be proven.
import { guideBundle, guideOperationOutcome, guideToken, SOURCE } from "./fixtures";
import type { Auth, Bundle, CallResult, Fhir, FhirType, PatientHit, SatusehatPort } from "./port";

type Kind = "create" | "update" | "read" | "search" | "patient" | "practitioner" | "token";
export type Scripted =
  | { kind: "ok" }
  | { kind: "http_4xx"; code?: string; path?: string }
  | { kind: "http_5xx" }
  | { kind: "timeout" | "lost"; commit?: "now" | "later" | "never" }
  | { kind: "throw" };

export type MockSatusehat = SatusehatPort & {
  source: typeof SOURCE;
  store: Map<string, Fhir>;
  calls: { kind: Kind; type?: FhirType; clientId?: string; organizationId?: string; token?: string }[];
  patients: Map<string, PatientHit[]>;
  practitioners: Map<string, string[]>;
  next(kind: Kind, s: Scripted): void;
  commitLate(): number;
  count(kind: Kind, type?: FhirType): number;
};

export function mockSatusehatPort(): MockSatusehat {
  const store = new Map<string, Fhir>();
  const script = new Map<Kind, Scripted[]>();
  const late: (() => void)[] = [];
  const calls: MockSatusehat["calls"] = [];
  const patients = new Map<string, PatientHit[]>();
  const practitioners = new Map<string, string[]>();
  let seq = 0;
  const take = (k: Kind): Scripted => script.get(k)?.shift() ?? { kind: "ok" };
  const tokenOk = (token: string) => /^tok-/.test(token);
  // A scripted failure for a write: the effect still happens now, later or never.
  const failWrite = <T>(s: Scripted, effect: () => T): CallResult<T> | null => {
    if (s.kind === "ok") return null;
    if (s.kind === "throw") throw new Error("network");
    if (s.kind === "http_4xx") return { kind: "http_4xx", status: 400, code: s.code ?? "invalid", path: s.path ?? null, body: guideOperationOutcome(s.code ?? "invalid", s.path ?? null) };
    if (s.kind === "http_5xx") return { kind: "http_5xx", status: 503 };
    if (s.commit === "now") effect();
    else if (s.commit === "later") late.push(() => void effect());
    return { kind: s.kind };
  };
  const failRead = <T>(s: Scripted): CallResult<T> | null => {
    if (s.kind === "ok") return null;
    if (s.kind === "throw") throw new Error("network");
    if (s.kind === "http_4xx") return { kind: "http_4xx", status: 400, code: s.code ?? "invalid", path: s.path ?? null, body: guideOperationOutcome(s.code ?? "invalid", s.path ?? null) };
    if (s.kind === "http_5xx") return { kind: "http_5xx", status: 503 };
    return { kind: s.kind };
  };
  return {
    source: SOURCE,
    store,
    calls,
    patients,
    practitioners,
    next: (k, s) => void script.set(k, [...(script.get(k) ?? []), s]),
    commitLate: () => {
      const n = late.length;
      late.splice(0).forEach((f) => f());
      return n;
    },
    count: (k, type) => calls.filter((c) => c.kind === k && (!type || c.type === type)).length,
    async token(auth: Auth) {
      calls.push({ kind: "token", clientId: auth.clientId, organizationId: auth.organizationId });
      const s = take("token");
      if (s.kind !== "ok") throw new Error("token_unavailable");
      return guideToken(`tok-${auth.clientId}-${++seq}`);
    },
    async searchPatientByNik(token, _env, nik) {
      calls.push({ kind: "patient", token });
      const f = failRead<PatientHit[]>(take("patient"));
      if (f) return f;
      if (!tokenOk(token)) return { kind: "http_4xx", status: 401, code: "login", path: null, body: guideOperationOutcome("login", null) };
      return { kind: "ok", status: 200, value: patients.get(nik) ?? [] };
    },
    async searchPractitionerByNik(token, _env, nik) {
      calls.push({ kind: "practitioner", token });
      const f = failRead<string[]>(take("practitioner"));
      if (f) return f;
      return { kind: "ok", status: 200, value: practitioners.get(nik) ?? [] };
    },
    async create(token, _env, body) {
      calls.push({ kind: "create", type: body.resourceType, token });
      const prefix: Record<string, string> = { Encounter: "enc", Condition: "cnd", Observation: "obs", Procedure: "prc", Medication: "med",
        MedicationRequest: "mrq", MedicationDispense: "mds" };
      const id = `${prefix[body.resourceType] ?? "res"}-${String(++seq).padStart(6, "0")}`;
      const effect = () => {
        store.set(id, { ...structuredClone(body), id, meta: { versionId: "1" } });
        return { id, versionId: "1" };
      };
      const f = failWrite(take("create"), effect);
      if (f) return f;
      return { kind: "ok", status: 201, value: effect() };
    },
    async update(token, _env, id, body) {
      calls.push({ kind: "update", type: body.resourceType, token });
      const cur = store.get(id);
      if (!cur) return { kind: "http_4xx", status: 404, code: "not-found", path: null, body: guideOperationOutcome("not-found", null) };
      const effect = () => {
        const v = String(Number((store.get(id)!.meta as { versionId: string }).versionId) + 1);
        store.set(id, { ...structuredClone(body), id, meta: { versionId: v } });
        return { id, versionId: v };
      };
      const f = failWrite(take("update"), effect);
      if (f) return f;
      return { kind: "ok", status: 200, value: effect() };
    },
    async read(token, _env, type, id) {
      calls.push({ kind: "read", type, token });
      const f = failRead<Fhir>(take("read"));
      if (f) return f;
      const r = store.get(id);
      return r && r.resourceType === type ? { kind: "ok", status: 200, value: structuredClone(r) }
        : { kind: "http_4xx", status: 404, code: "not-found", path: null, body: guideOperationOutcome("not-found", null) };
    },
    async search(token, _env, type, params) {
      calls.push({ kind: "search", type, token });
      const f = failRead<Bundle>(take("search"));
      if (f) return f;
      // the documented searches only (Q-19): Encounter?subject; Condition / Observation / Procedure / MedicationRequest ?encounter;
      // MedicationDispense ?subject&context; Medication has no search (the mock refuses it, as the guide documents none)
      if (type === "Medication") return { kind: "http_4xx", status: 400, code: "not-supported", path: null, body: guideOperationOutcome("not-supported", null) };
      const refOf = (v: unknown) => (v as { reference?: string } | undefined)?.reference;
      const hits = [...store.values()].filter((r) => r.resourceType === type && (
        type === "Encounter" ? refOf(r.subject) === `Patient/${params.subject}`
        : type === "MedicationDispense" ? refOf(r.subject) === `Patient/${params.subject}` && refOf(r.context) === `Encounter/${params.context}`
        : refOf(r.encounter) === `Encounter/${params.encounter}`));
      return { kind: "ok", status: 200, value: guideBundle(hits) };
    },
  };
}
