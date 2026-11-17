// SATUSEHAT reporting (PR-35, TD-30–TD-33, UX-23; T-102 increment 1, migration 0116, DEC-113). Signing a record never waits on SATUSEHAT: the
// record_versions trigger only inserts an outbox item. The worker (runSatusehatSync, an unbound connection) leases one item per visit after
// the visit closes, lets SQL derive the facility context and identity, sends Encounter + Conditions from the pinned signed version through the
// port (mock by default; DEC-082 — no live call is authorized), and records every attempt through fenced definers. Secrets: the client secret
// and the patient NIK are opened in this process only for the port call, never logged, stored in clear, returned or put in an event.
import { createHash } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode } from "../../../lib/command";
import { decryptField, encryptField, type KekRing, type TenantKeys, type WrappedDek } from "../../../lib/keys/envelope";
import { EncryptionUnavailableError, kekRing } from "../../../lib/keys/runtime";
import { ensureWabaTenantKeys } from "../../messaging/waba/waba";
import { IDENTITY_PURPOSE } from "../../patients/patients";
import { bindDeployEnv } from "../../payments/payments";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import { condition, conditionSystem, conditionValue, diagnosisRefs, dispenseSystem, encounter, encounterSystem, hasIdentifier, medication, medicationDispense,
  medicationRequest, medicationSystem, observation, observationSystem, prescriptionItemSystem, procedure, procedureSystem } from "./fhir";
import { mockSatusehatPort } from "./mock";
import type { Auth, CallResult, Fhir, SatusehatPort } from "./port";

export const SECRET_PURPOSE = "satusehat.secret";

export class SatusehatError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):?\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new SatusehatError(m[1] as ErrorCode, m[2] || undefined);
    throw e;
  }
}
function ring(): KekRing {
  const r = kekRing();
  if (!r) throw new EncryptionUnavailableError();
  return r;
}
function keysOf(tenantId: string, rows: { version: number; wrapped: string; is_current?: boolean }[]): TenantKeys | null {
  if (!rows.length) return null;
  const deks: WrappedDek[] = rows.map((r) => ({ tenantId, version: r.version, wrapped: r.wrapped }));
  const cur = rows.find((r) => r.is_current !== false) ?? rows[rows.length - 1];
  return { tenantId, current: deks.find((d) => d.version === cur.version)!, byVersion: (v) => deks.find((d) => d.version === v) };
}

// ── Bound commands ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Credentials of a branch (owner / admin_pusat): the secret sealed here with the tenant DEK; SQL never sees it in clear.
export async function setCredentials(db: pg.ClientBase, key: string, i: { branchId: string; environment: "sandbox" | "production";
  organizationId: string; clientId: string; clientSecret: string }) {
  await assertProductionGoLive(db);
  if (!/^.{8,500}$/.test(i.clientSecret)) throw new SatusehatError("ERR_INVALID_INPUT", "secret");
  const tenantId = (await db.query(`select app_tenant_id() t`)).rows[0].t as string;
  const keys = await ensureWabaTenantKeys(db, ring(), tenantId); // owner / admin_pusat + configuration (0104)
  const sealed = encryptField(ring(), keys, SECRET_PURPOSE, i.clientSecret);
  const body = { branch_id: i.branchId, environment: i.environment, organization_id: i.organizationId, client_id: i.clientId,
    secret_enc: sealed, dek_ref: `dek:v${sealed.split(".")[1]}` };
  // the idempotency body excludes the sealed value (a fresh IV each time); the secret's fingerprint is not stored either
  const out = await call(() => runCommand<string>(db, { command: "satusehat_credential_set", key,
    body: { branch_id: i.branchId, environment: i.environment, organization_id: i.organizationId, client_id: i.clientId } },
    async (c) => (await c.query(`select satusehat_credential_set($1, $2::jsonb) r`, [key, JSON.stringify(body)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { credentialId: out.result, replayed: out.replayed };
}
export const revokeCredentials = (db: pg.ClientBase, id: string) => call(() => db.query(`select satusehat_credential_revoke($1)`, [id])).then(() => undefined);
export type CredentialStatus = { id: string; branch_id: string; environment: string; organization_id: string; client_id: string; generation: number;
  created_at: string; revoked_at: string | null };
export const credentialStatus = (db: pg.ClientBase) =>
  call(async () => (await db.query(`select satusehat_credential_status() r`)).rows[0].r as CredentialStatus[]);

// The practitioner IHS id (DEC-113 (6)), entered by hand by the owner or a facility head. A NIK lookup would need the branch secret in a bound
// staff session; increment 1 keeps the secret worker-only and records the id manually (the lookup is a Panel 2 question for increment 3).
export async function linkPractitioner(db: pg.ClientBase, key: string, i: { staffId: string; ihs: string }) {
  await assertProductionGoLive(db);
  return call(async () => (await db.query(`select satusehat_practitioner_link_set($1, $2, $3, 'manual') r`, [key, i.staffId, i.ihs])).rows[0].r as string);
}

// The tenant's ICD-9 CM map for a service (owner / facility head; increment 2): a new row ends the current one; unvalidated until the
// owner-gated sandbox step. An already sent revision is never re-sent under the new map — only a later revision pins it.
export async function setCodeMap(db: pg.ClientBase, key: string, i: { itemId: string; code: string; display: string }) {
  await assertProductionGoLive(db);
  return call(async () => (await db.query(`select satusehat_code_map_set($1, $2, $3, $4) r`, [key, i.itemId, i.code, i.display])).rows[0].r as string);
}

export const resolveIdentity = (db: pg.ClientBase, patientId: string, ihs: string | null, evidence: string) =>
  call(async () => (await db.query(`select satusehat_identity_resolve($1, $2, $3) r`, [patientId, ihs, evidence])).rows[0].r as string);
export const setContextRoom = (db: pg.ClientBase, visitId: string, roomId: string) =>
  call(() => db.query(`select satusehat_context_room_set($1, $2)`, [visitId, roomId])).then(() => undefined);
export const RESEND_REASONS = ["remote_checked", "provider_recovered", "data_corrected"] as const;
export async function resend(db: pg.ClientBase, visitId: string, reason: (typeof RESEND_REASONS)[number]) {
  await bindDeployEnv(db);
  return call(async () => (await db.query(`select satusehat_resend($1, $2) r`, [visitId, reason])).rows[0].r as number);
}
export async function monitor(db: pg.ClientBase, branchId: string) {
  await bindDeployEnv(db);
  return call(async () => (await db.query(`select satusehat_monitor($1) r`, [branchId])).rows[0].r as { outbox: Record<string, number>; links: Record<string, number> });
}

// ── The UX-23 page (increment 3): the projection per role is decided in the database (satusehat_page) ─────────────────────────────────
export type PageException = { visit_id: string; type: string; status: string; reason: string | null; attempt_id: string | null;
  error_code: string | null; error_path: string | null; at: string; patient_id: string | null };
export type SatusehatPage = {
  role: string; branch_id: string; environment: "sandbox" | "production"; credential_active: boolean;
  counts?: { outbox: Record<string, number>; links: Record<string, number> };
  exceptions?: PageException[]; held_items?: { visit_id: string; reason: string; since: string }[];
  identity_queue?: { patient_id: string; mrn: string; name: string; reason: string | null; state: string }[];
  no_room?: { visit_id: string; signed_at: string }[]; rooms?: { id: string; name: string }[];
  practitioners?: { staff_id: string; name: string; ihs: string | null }[];
  services?: { item_id: string; code: string; name: string | null; map: { code: string; display: string; validated: boolean } | null }[];
  mine?: { visit_id: string; patient_id: string; patient_name: string; signed_at: string; state: string | null; links: { type: string; status: string; reason: string | null; error_code: string | null }[] }[];
};
export async function satusehatPage(db: pg.ClientBase, branchId: string) {
  await bindDeployEnv(db);
  return call(async () => (await db.query(`select satusehat_page($1) r`, [branchId])).rows[0].r as SatusehatPage);
}
// The provider's error body (clinical class): the facility head only; audited as a clinical read.
export const errorBody = (db: pg.ClientBase, attemptId: string) =>
  call(async () => (await db.query(`select satusehat_error_body($1) r`, [attemptId])).rows[0].r as Record<string, unknown>);

// ── The worker ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Tokens in worker memory only (plan §6): keyed by tenant (TEN-4), environment, branch, credential row, generation and organization; a rotated
// credential or a replaced organization gets a new key, so an old token is never used.
type CacheKey = string;
const tokens = new Map<CacheKey, { token: string; until: number }>();
export const tokenCacheKeys = () => [...tokens.keys()];
export const clearTokenCache = () => tokens.clear();

// Everything a builder reads, pinned per link revision by satusehat_materialize (increment 2 adds the other resource types' fields).
type Pinned = { visit_id: string; organization: string; patient_ihs: string; practitioner_ihs?: string; location_id?: string; arrived_at?: string;
  in_progress_at?: string; finished_at?: string; code?: string; rank?: number; display?: string; field?: string; value?: number; unit?: string; ucum?: string;
  effective?: string; execution_id?: string; start?: string; end?: string; item_id?: string; kfa?: string; prescription_id?: string; signa?: string;
  quantity?: string | number; authored_on?: string; dispensing_id?: string; handed_over?: string };
type LinkType = "Encounter" | "Condition" | "Observation" | "Procedure" | "Medication" | "MedicationRequest" | "MedicationDispense";
type Packet = {
  tenant_id: string; branch_id: string; visit_id: string; revision: number; environment: Auth["environment"]; organization_id: string;
  credential: { id: string; generation: number; organization_id: string; client_id: string; secret_enc: string };
  keys: { version: number; wrapped: string; is_current: boolean }[];
  links: { id: string; fhir_type: LinkType; local_key: string; status: string; remote_id: string | null; check_after: string | null;
    next_at: string; sent_refs: string[] | null; materialized: Pinned; previous: Pinned | null }[];
};
type IdentityPacket = { identity: { patient_id: string; identity_enc: string }; keys: Packet["keys"]; credential: Packet["credential"] | null;
  environment: Auth["environment"]; branch_id: string; tenant_id: string };

async function tokenFor(p: { tenant_id: string; branch_id: string; environment: Auth["environment"]; credential: Packet["credential"]; keys: Packet["keys"] },
  port: SatusehatPort, now: Date): Promise<string> {
  const c = p.credential;
  const k: CacheKey = [p.tenant_id, p.environment, p.branch_id, c.id, c.generation, c.organization_id].join("|");
  const hit = tokens.get(k);
  if (hit && hit.until > now.getTime()) return hit.token;
  const keys = keysOf(p.tenant_id, p.keys);
  if (!keys) throw new Error("token_unavailable");
  const t = await port.token({ environment: p.environment, organizationId: c.organization_id, clientId: c.client_id,
    clientSecret: decryptField(ring(), keys, SECRET_PURPOSE, c.secret_enc) });
  tokens.set(k, { token: t.accessToken, until: t.issuedAtMs + (t.expiresInSec - 60) * 1000 });
  return t.accessToken;
}

const outcomeOf = (r: CallResult<unknown>) => r.kind === "ok" ? { outcome: "ok", http_status: r.status }
  : r.kind === "http_4xx" ? { outcome: "http_4xx", http_status: r.status, error_code: r.code, error_path: r.path, body: r.body }
  : r.kind === "http_5xx" ? { outcome: "http_5xx", http_status: r.status } : { outcome: r.kind };

// The fingerprint of the mapped fields (review r1 P1-3, r2 P2-1): an explicit projection of exactly what the builders emit, per resource type,
// taken from the attempted body and from the read-back alike — every mapped reference and code compared, while anything the server adds
// (`id`, `meta`, `text`, a reference's `display`, extensions) is ignored. Arrays keep their order (diagnosis rank, statusHistory).
const pick = (o: unknown, keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown> | undefined)?.[k] ?? null]));
const ref = (r: unknown) => ((r as { reference?: unknown } | undefined)?.reference ?? null);
// a coding as the builders emit it: with its display where they write one (class, participant type, diagnosis use, clinical status,
// category — review r3), without one where they do not (the ICD-10 code; references never carry a writer display)
const codings = (c: unknown, display = true) =>
  (((c as { coding?: unknown[] } | undefined)?.coding ?? []) as unknown[]).map((x) => pick(x, display ? ["system", "code", "display"] : ["system", "code"]));
const idents = (r: Fhir) => ((r.identifier as unknown[] | undefined) ?? []).map((x) => pick(x, ["system", "use", "value"]));
export const MEDICATION_TYPE_URL = "https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationType";
export function mappedProjection(r: Fhir): Record<string, unknown> {
  if (r.resourceType === "Encounter") {
    return {
      resourceType: r.resourceType, identifier: idents(r), status: r.status ?? null, class: pick(r.class, ["system", "code", "display"]),
      subject: ref(r.subject), period: pick(r.period, ["start", "end"]), serviceProvider: ref(r.serviceProvider),
      participant: ((r.participant as unknown[] | undefined) ?? []).map((p) => ({
        type: (((p as { type?: unknown[] }).type ?? []) as unknown[]).map((c) => codings(c)), individual: ref((p as { individual?: unknown }).individual) })),
      location: ((r.location as unknown[] | undefined) ?? []).map((l) => ref((l as { location?: unknown }).location)),
      diagnosis: ((r.diagnosis as unknown[] | undefined) ?? []).map((d) => ({ condition: ref((d as { condition?: unknown }).condition),
        use: codings((d as { use?: unknown }).use), rank: (d as { rank?: unknown }).rank ?? null })),
      statusHistory: ((r.statusHistory as unknown[] | undefined) ?? []).map((h) => ({ status: (h as { status?: unknown }).status ?? null,
        period: pick((h as { period?: unknown }).period, ["start", "end"]) })),
    };
  }
  if (r.resourceType === "Condition") {
    return {
      resourceType: r.resourceType, identifier: idents(r), clinicalStatus: codings(r.clinicalStatus),
      category: ((r.category as unknown[] | undefined) ?? []).map((c) => codings(c)), code: codings(r.code, false), subject: ref(r.subject), encounter: ref(r.encounter),
    };
  }
  // Increment 2 (addendum r2): exactly the fields fhir.ts emits per type, displays where the builder writes one
  const refs = (a: unknown) => ((a as unknown[] | undefined) ?? []).map(ref);
  const actors = (a: unknown) => ((a as unknown[] | undefined) ?? []).map((x) => ref((x as { actor?: unknown }).actor));
  if (r.resourceType === "Observation") {
    return {
      resourceType: r.resourceType, identifier: idents(r), status: r.status ?? null, category: ((r.category as unknown[] | undefined) ?? []).map((c) => codings(c)),
      code: codings(r.code), subject: ref(r.subject), encounter: ref(r.encounter), performer: refs(r.performer), effectiveDateTime: r.effectiveDateTime ?? null,
      valueQuantity: pick(r.valueQuantity, ["value", "unit", "system", "code"]),
    };
  }
  if (r.resourceType === "Procedure") {
    return {
      resourceType: r.resourceType, identifier: idents(r), status: r.status ?? null, code: codings(r.code), subject: ref(r.subject), encounter: ref(r.encounter),
      performedPeriod: pick(r.performedPeriod, ["start", "end"]), performer: actors(r.performer),
    };
  }
  if (r.resourceType === "Medication") {
    return {
      resourceType: r.resourceType, identifier: idents(r), code: codings(r.code, false), status: r.status ?? null,
      // only the extension the builder writes (MedicationType); any other extension is provider-added and ignored (inc2 review r1 P1)
      extension: ((r.extension as unknown[] | undefined) ?? []).filter((e) => (e as { url?: unknown }).url === MEDICATION_TYPE_URL)
        .map((e) => ({ url: MEDICATION_TYPE_URL, value: codings((e as { valueCodeableConcept?: unknown }).valueCodeableConcept) })),
    };
  }
  if (r.resourceType === "MedicationRequest") {
    return {
      resourceType: r.resourceType, identifier: idents(r), status: r.status ?? null, intent: r.intent ?? null,
      category: ((r.category as unknown[] | undefined) ?? []).map((c) => codings(c)), medicationReference: ref(r.medicationReference), subject: ref(r.subject),
      encounter: ref(r.encounter), authoredOn: r.authoredOn ?? null, requester: ref(r.requester),
      dosageInstruction: ((r.dosageInstruction as unknown[] | undefined) ?? []).map((d) => pick(d, ["text"])),
      dispenseRequest: pick(pick(r.dispenseRequest, ["quantity"]).quantity, ["value"]), substitution: pick(r.substitution, ["allowedBoolean"]),
    };
  }
  return {
    resourceType: r.resourceType, identifier: idents(r), status: r.status ?? null, category: codings(r.category), medicationReference: ref(r.medicationReference),
    subject: ref(r.subject), context: ref(r.context), performer: actors(r.performer), authorizingPrescription: refs(r.authorizingPrescription),
    quantity: pick(r.quantity, ["value"]), whenHandedOver: r.whenHandedOver ?? null, substitution: pick(r.substitution, ["wasSubstituted"]),
  };
}
export const bodyFingerprint = (r: Fhir) => createHash("sha256").update(JSON.stringify(mappedProjection(r))).digest("hex");

// One remote step between fenced begin / finish definers; a thrown network error counts as lost (the write may have committed). The clock is
// read at each SQL boundary (review r1 P1-2): a lease that runs out during the remote call fences the answer.
async function step<T>(w: Q, clock: () => Date, item: string, gen: number, link: string, verb: "create" | "update" | "search" | "read",
  run: () => Promise<CallResult<T>>, extra: (r: CallResult<T>) => Record<string, unknown> = () => ({}), body?: Fhir) {
  const att = await w<string | null>(`select satusehat_begin($1, $2, $3, $4, $5, $6) a`, [item, gen, link, verb, clock(), body ? bodyFingerprint(body) : null]);
  if (!att) return null;
  let r: CallResult<T>;
  try {
    r = await run();
  } catch {
    r = { kind: "lost" };
  }
  const st = await w<string>(`select satusehat_finish($1, $2::jsonb, $3) s`, [att, JSON.stringify({ ...outcomeOf(r), ...extra(r) }), clock()]);
  return { r, status: st };
}

export type SyncResult = { leased: number; held: number; done: number; queued: number; stale: number; identity: number };

// One worker statement in its own short transaction with the deploy environment bound (DEL-3): no transaction ever stays open across a
// remote call, so a slow SATUSEHAT never holds a row lock or the signing path.
type Q = <T = unknown>(sql: string, args?: unknown[]) => Promise<T>;
function workerQ(worker: pg.Pool | pg.ClientBase): Q {
  return async (sql, args = []) => {
    const c = "connect" in worker && typeof (worker as pg.Pool).totalCount === "number" ? await (worker as pg.Pool).connect() : null;
    const db = c ?? (worker as pg.ClientBase);
    try {
      await db.query("begin");
      await bindDeployEnv(db);
      const r = (await db.query(sql, args)).rows[0];
      await db.query("commit");
      return (r ? Object.values(r)[0] : null) as never;
    } catch (e) {
      await db.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      c?.release();
    }
  };
}

// One worker pass: claim, then per item prepare → (identity lookup) → Conditions need a confirmed Encounter; the Encounter is created
// first without diagnoses, the Conditions next, then the Encounter is updated to name them (guide: Encounter.diagnosis) → release. `clock` is
// read at every SQL boundary (tests inject an advancing clock; production uses the wall clock).
export async function runSatusehatSync(worker: pg.Pool | pg.ClientBase, o: { now?: Date; clock?: () => Date; port?: SatusehatPort } = {}): Promise<SyncResult> {
  const port = o.port ?? mockSatusehatPort();
  const clock = o.clock ?? (o.now ? (() => o.now!) : () => new Date());
  const res: SyncResult = { leased: 0, held: 0, done: 0, queued: 0, stale: 0, identity: 0 };
  const w = workerQ(worker);
  const prepare = (c: { id: string; gen: number }) => w<Packet & IdentityPacket & { held?: string; stale?: boolean }>(`select satusehat_prepare($1, $2, $3) r`, [c.id, c.gen, clock()]);
  const release = async (c: { id: string; gen: number }) => {
    const st = await w<string>(`select satusehat_release($1, $2, $3) s`, [c.id, c.gen, clock()]);
    res[st === "done" ? "done" : st === "stale" ? "stale" : "queued"]++;
  };
  const claimed = await w<{ id: string; gen: number }[]>(`select satusehat_claim($1) r`, [clock()]);
  res.leased = claimed.length;
  for (const c of claimed) {
    let p = await prepare(c);
    if (p.stale) { res.stale++; continue; }
    if (p.held) { res.held++; continue; }
    if (p.identity) {
      res.identity++;
      const outcome = await identityLookup(p, port, clock());
      const st = await w<string>(`select satusehat_identity_record($1, $2, $3::jsonb, $4) s`, [c.id, c.gen, JSON.stringify(outcome), clock()]);
      if (st === "stale" || st === "retry") { res[st === "stale" ? "stale" : "queued"]++; continue; }
      p = await prepare(c); // review → held identity_review; matched → the work packet
      if (p.stale) { res.stale++; continue; }
      if (p.held) { res.held++; continue; }
    }
    let token: string;
    try {
      token = await tokenFor(p, port, clock());
    } catch {
      await release(c);
      continue;
    }
    await sendVisit(w, clock, c, p, port, token);
    if (await w<boolean>(`select satusehat_refs_check($1, $2, $3) r`, [c.id, c.gen, clock()])) {
      const q = await prepare(c);
      if (!q.stale && !q.held) await sendVisit(w, clock, c, q, port, token, true);
    }
    await release(c);
  }
  return res;
}

async function identityLookup(p: IdentityPacket, port: SatusehatPort, now: Date) {
  try {
    if (!p.credential) return { kind: "error" };
    const keys = keysOf(p.tenant_id, p.keys);
    if (!keys) return { kind: "error" };
    const token = await tokenFor({ ...p, credential: p.credential }, port, now);
    const nik = decryptField(ring(), keys, IDENTITY_PURPOSE, p.identity.identity_enc);
    const r = await port.searchPatientByNik(token, p.environment, nik);
    if (r.kind !== "ok") return { kind: "error" };
    if (r.value.length === 0) return { kind: "none" };
    if (r.value.length > 1) return { kind: "many" };
    const h = r.value[0];
    return { kind: "one", ihs: h.ihs, name: h.name, birth_date: h.birthDate, gender: h.gender };
  } catch {
    return { kind: "error" };
  }
}

// Bodies come only from the pinned values of the link's revision (review r1 P1-3), never from the current packet. `ids` holds the confirmed
// remote ids of the visit's parents (Encounter, Medication, MedicationRequest), by local key.
const encBody = (m: Pinned, diagnoses: string[]) => encounter({ org: m.organization, visitId: m.visit_id, patientIhs: m.patient_ihs,
  practitionerIhs: m.practitioner_ihs!, locationId: m.location_id!, arrivedAt: m.arrived_at!, inProgressAt: m.in_progress_at!, finishedAt: m.finished_at!, diagnoses });
type Ids = Map<string, string>;
function bodyFor(l: Packet["links"][number], ids: Ids): Fhir | null {
  const m = l.materialized;
  const enc = ids.get("Encounter:visit");
  const med = m.item_id ? ids.get(`Medication:med:${m.item_id}`) : undefined;
  const req = m.item_id ? ids.get(`MedicationRequest:mreq:${m.item_id}`) : undefined;
  switch (l.fhir_type) {
    case "Condition": return enc ? condition({ org: m.organization, visitId: m.visit_id, code: m.code!, patientIhs: m.patient_ihs, encounterId: enc }) : null;
    case "Observation": return enc ? observation({ org: m.organization, visitId: m.visit_id, field: m.field!, code: m.code!, display: m.display!,
      value: Number(m.value), unit: m.unit!, ucum: m.ucum!, patientIhs: m.patient_ihs, practitionerIhs: m.practitioner_ihs!, encounterId: enc, effective: m.effective! }) : null;
    case "Procedure": return enc ? procedure({ org: m.organization, executionId: m.execution_id!, code: m.code!, display: m.display!, patientIhs: m.patient_ihs,
      practitionerIhs: m.practitioner_ihs!, encounterId: enc, start: m.start!, end: m.end! }) : null;
    case "Medication": return medication({ org: m.organization, itemId: m.item_id!, kfa: m.kfa! });
    case "MedicationRequest": return enc && med ? medicationRequest({ org: m.organization, prescriptionId: m.prescription_id!, itemId: m.item_id!, medicationId: med,
      patientIhs: m.patient_ihs, encounterId: enc, practitionerIhs: m.practitioner_ihs!, authoredOn: m.authored_on!, signa: m.signa!, quantity: Number(m.quantity) }) : null;
    case "MedicationDispense": return enc && med && req ? medicationDispense({ org: m.organization, dispensingId: m.dispensing_id!, medicationId: med, requestId: req,
      patientIhs: m.patient_ihs, encounterId: enc, practitionerIhs: m.practitioner_ihs!, handedOver: m.handed_over!, quantity: Number(m.quantity) }) : null;
    default: return null;
  }
}
// The exact stable identifier a reconciliation matches (plan §5): MedicationRequest matches its per-item identifier.
function identityOf(l: Packet["links"][number]): { system: string; value: string } {
  const m = l.materialized;
  switch (l.fhir_type) {
    case "Encounter": return { system: encounterSystem(m.organization), value: m.visit_id };
    case "Condition": return { system: conditionSystem(m.organization), value: conditionValue(m.visit_id, m.code!) };
    case "Observation": return { system: observationSystem(m.organization), value: `${m.visit_id}:${m.field}` };
    case "Procedure": return { system: procedureSystem(m.organization), value: m.execution_id! };
    case "Medication": return { system: medicationSystem(m.organization), value: m.item_id! };
    case "MedicationRequest": return { system: prescriptionItemSystem(m.organization), value: m.item_id! };
    default: return { system: dispenseSystem(m.organization), value: m.dispensing_id! };
  }
}
// The documented search per type (Q-19 "Searches"); Medication has none (Detail Data only).
function searchParams(l: Packet["links"][number], ids: Ids): Record<string, string> | null {
  const enc = ids.get("Encounter:visit");
  switch (l.fhir_type) {
    case "Encounter": return { subject: l.materialized.patient_ihs };
    case "MedicationDispense": return enc ? { subject: l.materialized.patient_ihs, context: enc } : null;
    case "Medication": return null;
    default: return enc ? { encounter: enc } : null;
  }
}
const ok = <T>(r: CallResult<T>) => (r.kind === "ok" ? (r.value as unknown as { id: string; versionId: string | null }) : null);
const ORDER: LinkType[] = ["Encounter", "Condition", "Observation", "Procedure", "Medication", "MedicationRequest", "MedicationDispense"];

async function sendVisit(w: Q, clock: () => Date, c: { id: string; gen: number }, p: Packet, port: SatusehatPort, token: string, encounterOnly = false) {
  const enc = p.links.find((l) => l.fhir_type === "Encounter");
  if (!enc) return;
  const conds = p.links.filter((l) => l.fhir_type === "Condition");
  // the diagnoses the Encounter names: confirmed Conditions in rank order
  const diag = conds.filter((l) => l.status === "confirmed" && l.remote_id).sort((a, b) => Number(a.materialized.rank) - Number(b.materialized.rank)).map((l) => l.remote_id!);
  const ids: Ids = new Map(p.links.filter((l) => l.status === "confirmed" && l.remote_id).map((l) => [`${l.fhir_type}:${l.local_key}`, l.remote_id!]));
  const links = [...p.links].sort((a, b) => ORDER.indexOf(a.fhir_type) - ORDER.indexOf(b.fhir_type));
  for (const l of links) {
    if (encounterOnly && l.fhir_type !== "Encounter") continue;
    // only queued or uncertain links are worked; a held link has no pin for its revision (its inputs are incomplete) and is never built
    if (!l.materialized || !(l.status === "queued" || l.status === "outcome_unknown")) continue;
    const k = `${l.fhir_type}:${l.local_key}`;
    const body = l.fhir_type === "Encounter" ? encBody(l.materialized, diag) : bodyFor(l, ids);
    if (!body) continue; // a parent is not confirmed yet: dependency order (plan §2)
    const refs = l.fhir_type === "Encounter" ? { refs: diag } : {};
    if (l.status === "queued" && !l.remote_id) {
      const s = await step(w, clock, c.id, c.gen, l.id, "create", () => port.create(token, p.environment, body),
        (r) => ({ remote_id: ok(r)?.id ?? null, remote_version: ok(r)?.versionId ?? null, ...refs }), body);
      if (s?.status === "confirmed") ids.set(k, ok(s.r)!.id);
    } else if (l.status === "queued" && l.remote_id) {
      const s = await step(w, clock, c.id, c.gen, l.id, "update", () => port.update(token, p.environment, l.remote_id!, body),
        (r) => ({ remote_id: l.remote_id, remote_version: ok(r)?.versionId ?? null, ...refs }), body);
      if (s?.status === "confirmed") ids.set(k, l.remote_id);
    } else if (l.status === "outcome_unknown") {
      const id = await reconcile(w, clock, c, p, port, token, l, ids);
      if (id) ids.set(k, id);
    }
  }
}

// Plan §5: an uncertain create is searched by the exact stable identifier with the documented parameters; Medication has no search, so an
// uncertain Medication create becomes an exception at once (no fallback, no blind retry). An uncertain update is read back by id and the
// fingerprint of its mapped fields compared (in SQL) with the fingerprint of the body the uncertain write sent.
async function reconcile(w: Q, clock: () => Date, c: { id: string; gen: number }, p: Packet, port: SatusehatPort, token: string,
  l: Packet["links"][number], ids: Ids): Promise<string | null> {
  if (new Date(l.check_after ?? 0) > clock()) return null;
  if (!l.remote_id) {
    if (l.fhir_type === "Medication") {
      await w(`select satusehat_no_search($1, $2, $3, $4)`, [c.id, c.gen, l.id, clock()]);
      return null;
    }
    const params = searchParams(l, ids);
    if (!params) return null; // its parent is not confirmed yet: the search waits
    const { system, value } = identityOf(l);
    const isEnc = l.fhir_type === "Encounter";
    const s = await step(w, clock, c.id, c.gen, l.id, "search", () => port.search(token, p.environment, l.fhir_type, params),
      (r) => {
        if (r.kind !== "ok") return {};
        const b = r.value as { total: number; entries: Fhir[]; hasNext: boolean };
        if (b.hasNext || b.total > b.entries.length) return { outcome: "incomplete" };
        const hits = b.entries.filter((e) => hasIdentifier(e, system, value));
        return hits.length === 1 ? { remote_id: hits[0].id, ...(isEnc ? { refs: diagnosisRefs(hits[0]) } : {}) }
          : { outcome: hits.length ? "many" : "not_found" };
      });
    return s?.status === "confirmed" ? (s.r as { value: { entries: Fhir[] } }).value.entries.find((e) => hasIdentifier(e, system, value))?.id ?? null : null;
  }
  const s = await step(w, clock, c.id, c.gen, l.id, "read", () => port.read(token, p.environment, l.fhir_type, l.remote_id!), (r) => {
    if (r.kind !== "ok") return {};
    const got = r.value as Fhir;
    return { read_fingerprint: bodyFingerprint(got), ...(l.fhir_type === "Encounter" ? { refs: diagnosisRefs(got) } : {}) };
  });
  return s?.status === "confirmed" ? l.remote_id : null;
}
