// Doctor public listing consent DB adapter & PR-65/PR-66 validation gate (T-125).
// Reuses T-124's canonical Permenkes 1787/2010 checkText() linter (zero duplicate regex),
// enforces factual-only doctor profiles, immediate atomic purge on withdrawal, and live Q-15
// counsel gating on titles & SIP numbers (never exposing staff_id, SIP expiry, or contacts).
import type { Pool, PoolClient } from "pg";
import { checkText, type Violation } from "../rules/rules";

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export const DOCTOR_SLUG = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const ALLOWED_DOCTOR_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type DoctorPhotoMediaType = (typeof ALLOWED_DOCTOR_PHOTO_TYPES)[number];
export const MAX_DOCTOR_PHOTO_BYTES = 524_288;

export function isValidDoctorPhotoBytes(bytes: Buffer, mediaType: string): boolean {
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_DOCTOR_PHOTO_BYTES) return false;
  if (mediaType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mediaType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mediaType === "image/webp") {
    return (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

export type PublicDoctorSip = Readonly<{
  branchSlug: string;
  branchName: string;
  sip: string;
}>;

export type PublicDoctorDto = Readonly<{
  slug: string;
  name: string;
  title: string | null;
  scheduleSummary: string | null;
  sipNumbers: PublicDoctorSip[];
  focusAreas: string[];
  photoUrl: string | null;
  branchSlugs: string[];
}>;

export type ResolvedPublicDoctorDetail =
  | { state: "found"; doctor: PublicDoctorDto }
  | { state: "not_found" };

export type DoctorConsentRecord = Readonly<{
  id: string;
  staffId: string;
  state: "granted" | "withdrawn";
  publicSlug: string;
  displayName: string;
  title: string | null;
  scheduleSummary: string | null;
  focusAreas: string[];
  showPhoto: boolean;
  photoRef: string | null;
  showTitleAndSip: boolean;
  acknowledgementRef: string | null;
  consentSha256: string;
  grantedAt: string;
  grantedBy: string;
  grantedAs: string;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawnAs: string | null;
  withdrawalReason: string | null;
}>;

export type GrantDoctorConsentInput = {
  staffId: string;
  publicSlug: string;
  displayName: string;
  title?: string | null;
  scheduleSummary?: string | null;
  focusAreas?: string[];
  showPhoto?: boolean;
  photoBytes?: Buffer | null;
  photoMediaType?: DoctorPhotoMediaType | null;
  showTitleAndSip?: boolean;
  acknowledgementRef?: string | null;
};

export type DoctorCopyValidation =
  | { ok: true }
  | { ok: false; code: string; violations: Violation[] };

export function validateDoctorPublicCopy(
  input: Pick<
    GrantDoctorConsentInput,
    "publicSlug" | "displayName" | "title" | "scheduleSummary" | "focusAreas" | "showPhoto" | "photoBytes" | "photoMediaType"
  >,
): DoctorCopyValidation {
  const slug = input.publicSlug.trim().toLowerCase();
  if (!DOCTOR_SLUG.test(slug)) {
    return { ok: false, code: "invalid_public_slug", violations: [] };
  }
  const name = input.displayName.trim();
  if (name.length < 2 || name.length > 120) {
    return { ok: false, code: "invalid_display_name", violations: [] };
  }
  const title = input.title?.trim() || null;
  if (title && title.length > 120) {
    return { ok: false, code: "invalid_title", violations: [] };
  }
  const schedule = input.scheduleSummary?.trim() || null;
  if (schedule && (schedule.length < 2 || schedule.length > 240)) {
    return { ok: false, code: "invalid_schedule_summary", violations: [] };
  }
  const areas = (input.focusAreas ?? []).map((x) => x.trim());
  if (areas.length > 12) {
    return { ok: false, code: "too_many_focus_areas", violations: [] };
  }
  for (const area of areas) {
    if (area.length < 2 || area.length > 100) {
      return { ok: false, code: "invalid_focus_area", violations: [] };
    }
  }
  const hasPhotoInput = Boolean(input.photoBytes || input.photoMediaType);
  if (!input.showPhoto && hasPhotoInput) {
    return { ok: false, code: "photo_ref_requires_show_photo", violations: [] };
  }
  if (input.showPhoto && hasPhotoInput) {
    if (!input.photoBytes || !input.photoMediaType || !isValidDoctorPhotoBytes(input.photoBytes, input.photoMediaType)) {
      return { ok: false, code: "invalid_photo_asset", violations: [] };
    }
  }

  const violations: Violation[] = [
    ...checkText("publicSlug", slug.replace(/-/g, " ")),
    ...checkText("displayName", name),
    ...checkText("title", title),
    ...checkText("scheduleSummary", schedule),
    ...areas.flatMap((a, idx) => checkText(`focusAreas[${idx}]`, a)),
  ];
  if (violations.length > 0) {
    return { ok: false, code: "forbidden_promotional_copy", violations };
  }
  return { ok: true };
}

export async function grantDoctorListingConsent(
  db: Db,
  input: GrantDoctorConsentInput,
): Promise<{ id: string; publicSlug: string; photoUrl: string | null; state: "granted"; consentSha256: string }> {
  const check = validateDoctorPublicCopy(input);
  if (!check.ok) {
    throw new Error(`ERR_INVALID_INPUT: ${check.code}`);
  }
  const { rows } = await db.query<{
    res: { id: string; publicSlug: string; photoUrl: string | null; state: "granted"; consentSha256: string };
  }>(
    `SELECT public.doctor_listing_grant(
       $1::uuid, $2::text, $3::text, $4::text, $5::text,
       $6::text[], $7::boolean, $8::bytea, $9::text, $10::boolean, $11::text
     ) AS res`,
    [
      input.staffId,
      input.publicSlug.trim().toLowerCase(),
      input.displayName.trim(),
      input.title?.trim() || null,
      input.scheduleSummary?.trim() || null,
      (input.focusAreas ?? []).map((x) => x.trim()),
      Boolean(input.showPhoto),
      input.showPhoto ? (input.photoBytes ?? null) : null,
      input.showPhoto ? (input.photoMediaType ?? null) : null,
      Boolean(input.showTitleAndSip),
      input.acknowledgementRef?.trim() || null,
    ],
  );
  return rows[0].res;
}

export async function withdrawDoctorListingConsent(
  db: Db,
  staffId: string,
  reason = "withdrawn_by_doctor",
): Promise<{ id: string; state: "withdrawn" }> {
  const { rows } = await db.query<{ res: { id: string; state: "withdrawn" } }>(
    `SELECT public.doctor_listing_withdraw($1::uuid, $2::text) AS res`,
    [staffId, reason],
  );
  return rows[0].res;
}

export async function listDoctorListingConsents(db: Db): Promise<DoctorConsentRecord[]> {
  const { rows } = await db.query<{ rows: DoctorConsentRecord[] }>(
    `SELECT public.doctor_listing_list() AS rows`,
  );
  return rows[0]?.rows ?? [];
}

export async function resolvePublicDoctorsBySlug(slug: string, db: Db): Promise<PublicDoctorDto[]> {
  const { rows } = await db.query<{ docs: PublicDoctorDto[] }>(
    `SELECT public.public_doctors_by_slug($1::text) AS docs`,
    [slug],
  );
  return rows[0]?.docs ?? [];
}

export async function resolvePublicDoctorDetail(
  slug: string,
  doctorSlug: string,
  db: Db,
): Promise<ResolvedPublicDoctorDetail> {
  const { rows } = await db.query<{ res: ResolvedPublicDoctorDetail }>(
    `SELECT public.public_doctor_detail($1::text, $2::text) AS res`,
    [slug, doctorSlug],
  );
  return rows[0]?.res ?? { state: "not_found" };
}

export type ResolvedPublicDoctorPhoto =
  | { state: "found"; mediaType: DoctorPhotoMediaType; bytes: Buffer }
  | { state: "not_found" };

export async function resolvePublicDoctorPhoto(
  slug: string,
  doctorSlug: string,
  version: string,
  db: Db,
): Promise<ResolvedPublicDoctorPhoto> {
  const { rows } = await db.query<{
    res: { state: "found"; mediaType: DoctorPhotoMediaType; bytesBase64: string } | { state: "not_found" };
  }>(`SELECT public.public_doctor_photo($1::text, $2::text, $3::text) AS res`, [slug, doctorSlug, version]);
  const res = rows[0]?.res;
  if (!res || res.state !== "found") return { state: "not_found" };
  return {
    state: "found",
    mediaType: res.mediaType,
    bytes: Buffer.from(res.bytesBase64, "base64"),
  };
}
