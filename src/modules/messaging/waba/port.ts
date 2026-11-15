// The Meta Graph port for WABA onboarding (PR-27, TD-20, TD-24, TD-25, TD-27; T-089, DEC-101). Four calls; the adapter in tests and local runs
// is the mock (mock.ts, recorded responses in fixtures.ts). DEC-082: no live Meta call is authorized — a live adapter is a later, owner-approved
// step. The port never reaches SQL: the app calls it, seals the secrets and passes the recorded result to the definers.
export type OnboardingChannel = "cloud_api" | "bsp_fallback";
export type VerificationStatus = "unverified" | "pending" | "verified";
export type TokenKind = "business_integration_system_user" | "system_user" | "bsp_api_key";
export type DisplayNameStatus = "none" | "pending_review" | "approved" | "declined";
export type QualityRating = "unknown" | "green" | "yellow" | "red";

export type ExchangeResult = {
  accessToken: string; tokenKind: TokenKind; grantedScopes: string[]; metaWabaId: string; metaBusinessId: string;
  businessVerificationStatus: VerificationStatus; portfolioMessagingLimit: number;
};
export type RegisterResult = { registered: boolean; phoneNumberId: string; verifiedName: string; displayNameStatus: DisplayNameStatus;
  qualityRating: QualityRating };
export type WabaStatusResult = { businessVerificationStatus: VerificationStatus; portfolioMessagingLimit: number;
  numbers: Record<string, { displayNameStatus: DisplayNameStatus; qualityRating: QualityRating; verifiedName: string }> };

export interface WabaGraphPort {
  exchangeCode(i: { code: string; onboardingChannel: OnboardingChannel; bspProvider?: string | null }): Promise<ExchangeResult>;
  subscribeApp(i: { metaWabaId: string; accessToken: string }): Promise<{ subscribed: boolean }>;
  registerNumber(i: { metaWabaId: string; phoneNumberId: string; phoneNumber: string; displayName: string; pin: string; isCoexistence: boolean;
    historySyncEnabled: boolean; accessToken: string }): Promise<RegisterResult>;
  fetchWabaStatus(i: { metaWabaId: string; phoneNumberIds: string[]; accessToken: string }): Promise<WabaStatusResult>;
}
