// The fixed legal delegation floor (DEC-047 (3), class F, pending the clinical lead Q-07): the most a
// profession may do per service category. Mirror of the delegation_floor table seeded by migration
// 0055; tests/catalog/service.test.ts keeps them equal. catalog_publish enforces it; the screens use
// this copy only to offer the allowed modes. No imports: the client form uses it (the lists equal
// SERVICE_CATEGORIES and ELIGIBLE_PROFESSIONS in ../schema; the test compares with the database).
export const CATEGORIES = ["filler", "toxin", "threads", "laser_ablative", "injection", "infusion", "laser_non_ablative", "peeling_chemical", "microneedling", "facial", "body_treatment", "consultation"] as const;
export const PROFESSIONS = ["doctor", "nurse", "therapist"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Profession = (typeof PROFESSIONS)[number];
export type FloorMode = "performs" | "supervised" | "assists" | "none";

export const MODE_RANK: Record<FloorMode, number> = { performs: 3, supervised: 2, assists: 1, none: 0 };

const NURSE_ASSISTS: Category[] = ["filler", "toxin", "threads", "laser_ablative", "consultation"];
const NON_MEDICAL: Category[] = ["facial", "body_treatment"];

export function floorMode(category: Category, profession: Profession): FloorMode {
  if (profession === "doctor") return "performs";
  if (NON_MEDICAL.includes(category)) return "performs";
  if (profession === "therapist") return "none";
  return NURSE_ASSISTS.includes(category) ? "assists" : "supervised";
}

export const FLOOR: { category: Category; profession: Profession; maxMode: FloorMode }[] = CATEGORIES.flatMap((category) =>
  PROFESSIONS.map((profession) => ({ category, profession, maxMode: floorMode(category, profession) })),
);

// The modes a profession may be given for a category (empty when none).
export const allowedModes = (category: Category, profession: Profession) =>
  (["performs", "supervised", "assists"] as const).filter((m) => MODE_RANK[m] <= MODE_RANK[floorMode(category, profession)]);
