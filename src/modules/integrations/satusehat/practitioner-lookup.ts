// T-102 increment 4 (TD-31, Panel 2 decision 2026-11-19: ephemeral worker-sealed lookup; DEC-113 (6) manual linking stays): the one-off
// practitioner NIK lookup. Pure pieces and the worker step, no SQL here (the table `satusehat_practitioner_lookups` and its three definers
// land with the migration; see the T-102 inc4 System Map delta):
// - `parseNik`: a strict 16-digit NIK; its errors never carry the value.
// - `sealLookupNik` / `openLookupNik`: the NIK sealed at once in the server action with the tenant DEK under purpose `satusehat.lookup_nik`.
//   The envelope AAD binds tenant + purpose + DEK version; the lookup binding (staff, lookup row) is authenticated INSIDE the GCM plaintext
//   ("staff|lookup|nik") and checked on open, so a sealed value moved to another staff member's or another lookup's row is refused, and one
//   moved to another tenant fails to decrypt.
// - `practitionerQuery` / `classifyPractitionerBundle`: the documented search (Q-19) `GET {base}/Practitioner?identifier=
//   https://fhir.kemkes.go.id/id/nik|<nik>` and the outcome of its FHIR searchset Bundle — exactly one Practitioner with an id → matched;
//   zero → not_found; several → ambiguous (never auto-selected, TD-31); anything malformed → failed.
// - `runPractitionerLookup`: the worker step on one claimed lookup (unbound worker; the branch secret and the NIK opened in this process only,
//   through the port — mock by default, DEC-082; no live adapter exists). Returns only the outcome; the caller's definer records it and
//   clears nik_enc in the same terminal transition.
import { decryptField, encryptField, type KekRing, type TenantKeys } from "../../../lib/keys/envelope";
import type { Auth, CallResult, SatusehatPort } from "./port";

export const LOOKUP_PURPOSE = "satusehat.lookup_nik";
export const NIK_SYSTEM = "https://fhir.kemkes.go.id/id/nik";
const NIK = /^[0-9]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A Practitioner id as the platform issues it (IHS number); conservative, the same shape the manual link accepts.
const IHS = /^[A-Za-z0-9-]{3,64}$/;

// An error whose message and fields never contain the NIK (only a reason code).
export class LookupInputError extends Error {
  constructor(readonly reason: "nik_format" | "binding") {
    super(reason === "nik_format" ? "NIK harus 16 angka." : "lookup binding refused");
    this.name = "LookupInputError";
  }
  toJSON() {
    return { name: this.name, reason: this.reason };
  }
}

// Spaces and dashes a person may type are dropped; anything else (letters, 15 or 17 digits) is refused without echoing the input.
export function parseNik(input: unknown): string {
  const s = typeof input === "string" ? input.replace(/[\s-]/g, "") : "";
  if (!NIK.test(s)) throw new LookupInputError("nik_format");
  return s;
}

export type Binding = { staffId: string; lookupId: string };
function checkBinding(b: Binding) {
  if (!UUID.test(b.staffId) || !UUID.test(b.lookupId)) throw new LookupInputError("binding");
}

export function sealLookupNik(ring: KekRing, keys: TenantKeys, b: Binding, nik: string): string {
  checkBinding(b);
  return encryptField(ring, keys, LOOKUP_PURPOSE, `${b.staffId}|${b.lookupId}|${parseNik(nik)}`);
}

// Opens a sealed NIK for the row it was sealed for; any other row (another staff member or lookup) is refused, never decrypted to a NIK.
export function openLookupNik(ring: KekRing, keys: TenantKeys, b: Binding, sealed: string): string {
  checkBinding(b);
  const plain = decryptField(ring, keys, LOOKUP_PURPOSE, sealed);
  const [staff, lookup, nik, ...rest] = plain.split("|");
  if (rest.length || staff !== b.staffId || lookup !== b.lookupId || !NIK.test(nik ?? "")) throw new LookupInputError("binding");
  return nik;
}

// ── the documented search and its Bundle ───────────────────────────────────────────────────────────────────────────────────────────
// Sandbox base as recorded from the platform docs (docs/tasks/T-102.md Q-19 table: api-code/access-sandbox). The production base is not
// recorded in the repository yet: it is taken from the owner-gated go-live step (TD-34), never guessed here, so the builder takes the base.
export const SANDBOX_FHIR_BASE = "https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1";
// The request a live adapter sends (no adapter calls it yet; TD-34 sandbox step). The NIK is in the query string as the platform documents
// (docs/tasks/T-102.md: api-catalogue/onboardings/apis/practitioner — GET Practitioner?identifier=https://fhir.kemkes.go.id/id/nik|<nik>).
export function practitionerQuery(base: string, nik: string): { method: "GET"; url: string } {
  const u = new URL(`${base.replace(/\/+$/, "")}/Practitioner`);
  u.searchParams.set("identifier", `${NIK_SYSTEM}|${parseNik(nik)}`);
  return { method: "GET", url: u.toString() };
}

export type LookupOutcome =
  | { state: "matched"; ihs: string }
  | { state: "not_found" }
  | { state: "ambiguous"; count: number }
  | { state: "failed"; reason: "http_4xx" | "http_5xx" | "timeout" | "lost" | "malformed" | "token" | "binding" | "keys" | "expired" };

// A FHIR searchset Bundle of Practitioner resources → the outcome. Only Practitioner entries with a valid id count; an entry of another type
// or without an id makes the Bundle malformed (failed), never a partial match. `total` disagreeing with the entries is malformed too.
export function classifyPractitionerBundle(body: unknown): LookupOutcome {
  if (!body || typeof body !== "object") return { state: "failed", reason: "malformed" };
  const b = body as { resourceType?: unknown; type?: unknown; total?: unknown; entry?: unknown };
  if (b.resourceType !== "Bundle" || (b.type !== undefined && b.type !== "searchset")) return { state: "failed", reason: "malformed" };
  const entries = b.entry === undefined ? [] : b.entry;
  if (!Array.isArray(entries)) return { state: "failed", reason: "malformed" };
  const ids: string[] = [];
  for (const e of entries) {
    const r = (e as { resource?: { resourceType?: unknown; id?: unknown } } | null)?.resource;
    if (!r || r.resourceType !== "Practitioner" || typeof r.id !== "string" || !IHS.test(r.id)) return { state: "failed", reason: "malformed" };
    ids.push(r.id);
  }
  if (b.total !== undefined && (typeof b.total !== "number" || b.total !== ids.length)) return { state: "failed", reason: "malformed" };
  const distinct = [...new Set(ids)];
  if (distinct.length === 0) return { state: "not_found" };
  if (distinct.length > 1) return { state: "ambiguous", count: distinct.length };
  return { state: "matched", ihs: distinct[0] };
}

// The port answer (already the list of ids the adapter extracted from the Bundle) → the outcome, with the same rules.
export function classifyPortAnswer(r: CallResult<string[]>): LookupOutcome {
  if (r.kind !== "ok") return { state: "failed", reason: r.kind };
  return classifyPractitionerBundle({ resourceType: "Bundle", type: "searchset",
    entry: r.value.map((id) => ({ resource: { resourceType: "Practitioner", id } })) });
}

// ── the worker step ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// What the claim definer hands the worker for one lookup (planned `satusehat_practitioner_lookup_claim`): the row, the branch credential and
// the tenant DEKs. The token comes from the worker's token cache (tokenFor in satusehat.ts) through `token`.
export type LookupPacket = {
  lookupId: string; staffId: string; nikEnc: string | null; expiresAt: string; environment: Auth["environment"];
};
// review b62a4c56 F2: `clock` is read again after every await. The token is acquired BEFORE the NIK is opened, and expiry is rechecked with a
// fresh reading after the token wait — a lookup that expires while the token is pending is never opened or sent (the SQL record step still
// fences and erases).
export async function runPractitionerLookup(p: LookupPacket, deps: {
  port: SatusehatPort; ring: KekRing; keys: TenantKeys | null; token: () => Promise<string>; clock: () => Date;
}): Promise<LookupOutcome> {
  const expired = () => !p.nikEnc || new Date(p.expiresAt).getTime() <= deps.clock().getTime();
  if (expired()) return { state: "failed", reason: "expired" };
  if (!deps.keys) return { state: "failed", reason: "keys" };
  let token: string;
  try {
    token = await deps.token();
  } catch {
    return { state: "failed", reason: "token" };
  }
  if (expired()) return { state: "failed", reason: "expired" };
  let nik: string;
  try {
    nik = openLookupNik(deps.ring, deps.keys, { staffId: p.staffId, lookupId: p.lookupId }, p.nikEnc as string);
  } catch {
    return { state: "failed", reason: "binding" };
  }
  try {
    return classifyPortAnswer(await deps.port.searchPractitionerByNik(token, p.environment, nik));
  } catch {
    return { state: "failed", reason: "lost" };
  }
}
