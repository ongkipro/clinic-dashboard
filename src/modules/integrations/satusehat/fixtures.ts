// Guide-shaped synthetic fixtures (T-102): structures copied from the official SATUSEHAT platform docs pages cited in Q-19 (Akses Token,
// FHIR searchset Bundle, OperationOutcome); every value is synthetic. These are NOT recordings of the sandbox: the owner-gated sandbox step
// (TD-34) records real responses into the same shapes.
import type { Bundle, Fhir, Token } from "./port";

export const SOURCE = "guide-shaped, not recorded" as const;

// Akses Token (api-catalogue/authentication/apis/token): token_type BearerToken, expires_in seconds as a string, issued_at in ms as a string.
export function guideToken(accessToken: string, now = Date.now()): Token {
  const raw = { token_type: "BearerToken", issued_at: String(now), access_token: accessToken, expires_in: "3599", status: "approved" };
  return { accessToken: raw.access_token, expiresInSec: Number(raw.expires_in), issuedAtMs: Number(raw.issued_at) };
}

// A searchset Bundle (Encounter / Condition "Pencarian Data"): total, entry[].resource, search.mode match.
export function guideBundle(resources: Fhir[], o: { total?: number; next?: boolean } = {}): Bundle {
  return { total: o.total ?? resources.length, entries: resources.map((r) => structuredClone(r)), hasNext: o.next ?? false };
}

// OperationOutcome of a 4xx (issue[].severity, code, details.text, expression).
export function guideOperationOutcome(code: string, path: string | null): Record<string, unknown> {
  return { resourceType: "OperationOutcome", issue: [{ severity: "error", code, details: { text: "synthetic" }, ...(path ? { expression: [path] } : {}) }] };
}
