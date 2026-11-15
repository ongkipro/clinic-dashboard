// Recorded Graph v21.0 responses for the mock adapter (T-089; synthetic ids, no real business, token or number). Each code names a scenario:
// an unverified business (the scenario PR-27 cap), a verified one, a BSP fallback; the status reads move display names and quality.
import type { ExchangeResult, RegisterResult, WabaStatusResult } from "./port";

export const FIXTURE_CODES = ["code-unverified", "code-unverified-2", "code-verified", "code-verified-2", "code-bsp", "code-cloud-after-bsp"] as const;
export type FixtureCode = (typeof FIXTURE_CODES)[number];

// Code exchange (Embedded Signup → the business integration system user token; a BSP key for the fallback).
export const EXCHANGE: Record<FixtureCode, Omit<ExchangeResult, "accessToken">> = {
  "code-unverified": { tokenKind: "business_integration_system_user", grantedScopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
    metaWabaId: "100000000000001", metaBusinessId: "200000000000001", businessVerificationStatus: "unverified", portfolioMessagingLimit: 250 },
  "code-unverified-2": { tokenKind: "business_integration_system_user", grantedScopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
    metaWabaId: "100000000000005", metaBusinessId: "200000000000005", businessVerificationStatus: "unverified", portfolioMessagingLimit: 250 },
  "code-verified": { tokenKind: "business_integration_system_user", grantedScopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
    metaWabaId: "100000000000002", metaBusinessId: "200000000000002", businessVerificationStatus: "verified", portfolioMessagingLimit: 1000 },
  "code-verified-2": { tokenKind: "business_integration_system_user", grantedScopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
    metaWabaId: "100000000000004", metaBusinessId: "200000000000004", businessVerificationStatus: "verified", portfolioMessagingLimit: 1000 },
  "code-bsp": { tokenKind: "bsp_api_key", grantedScopes: ["bsp_messaging"], metaWabaId: "100000000000003", metaBusinessId: "200000000000003",
    businessVerificationStatus: "unverified", portfolioMessagingLimit: 250 },
  "code-cloud-after-bsp": { tokenKind: "business_integration_system_user", grantedScopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
    metaWabaId: "100000000000003", metaBusinessId: "200000000000003", businessVerificationStatus: "unverified", portfolioMessagingLimit: 250 },
};
// A synthetic token per code: deterministic, recognisably fake, never a real credential.
export const fixtureToken = (code: FixtureCode) => `EAAFIXTURE${code.replace(/[^a-z]/g, "").toUpperCase()}TOKEN0000000000`;

// Number registration: the display name goes to review; quality starts unknown (green once Meta has data).
export const REGISTER = (phoneNumberId: string, displayName: string): RegisterResult => ({
  registered: true, phoneNumberId, verifiedName: displayName, displayNameStatus: "pending_review", qualityRating: "unknown",
});

// Status reads, by step: "approved" (names approved, quality green), "declined", "red" (the first number red), "green", "verified" (the business
// verified, the portfolio limit raised; the mock keeps it verified afterwards).
export type StatusStep = "approved" | "declined" | "red" | "green" | "verified";
export function STATUS(step: StatusStep, base: { verification: WabaStatusResult["businessVerificationStatus"]; limit: number }, numberIds: string[]): WabaStatusResult {
  const display = step === "declined" ? "declined" : "approved";
  const quality = step === "red" ? "red" : "green";
  return {
    businessVerificationStatus: step === "verified" ? "verified" : base.verification,
    portfolioMessagingLimit: step === "verified" ? 1000 : base.limit,
    numbers: Object.fromEntries(numberIds.map((id, i) => [id, { displayNameStatus: display, qualityRating: i === 0 ? quality : "green", verifiedName: "" }])),
  };
}
