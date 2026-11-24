// The seven pharmacist checks (PR-18, CLIN-018), shared by the server module and the client form. Kept apart from
// pharmacy.ts so a client component never imports the server-side step-up authority it uses (HYG-026).
import type { PHARMACIST_CHECKS } from "./schema";

export type Check = (typeof PHARMACIST_CHECKS)[number];
export const CHECKS: readonly Check[] = ["identity", "validity", "dose", "allergy", "clarification", "label", "counselling"];
