// Vendor profile (PR-55, DATA-47, S-04, H-02d). Server only.
// - Reads for the clinic app go through vendor_identity() / vendor_go_live_blockers()
//   (security definer; the clinic app has no access to the table, TEN-16).
// - Writes run on the platform operator connection (the database owner until the vendor
//   console and vendor roles exist, T-020/T-021) and are allowed for the platform owner
//   only (19 §3 Profil Vendor); the residency opinion likewise (PR-55: product owner
//   only). Every change writes one vendor_profile_changes row per field, in the same
//   transaction.
// - Placeholders render marked (renderField) and block production go-live
//   (assertProductionGoLive). This task delivers both primitives; tenant activation
//   (T-022), patient creation, public booking, receipts and legal pages call them.
// - Every function takes a client the caller owns, never inside an open transaction of
//   the caller's: the operator writes open their own transaction and refuse a nested one.
import { createHash } from "node:crypto";
import type pg from "pg";
import { STORAGE_KINDS, VENDOR_PROFILE_FIELDS, type VendorProfileField } from "../schema";

export type VendorRole = "platform_owner" | "onboarding" | "support" | "vendor_finance" | "vendor_auditor";
export type VendorActor = { accountId: string; vendorRole: VendorRole };

export class VendorProfileError extends Error {}

export type VendorIdentity = Record<VendorProfileField, string> & { placeholders: VendorProfileField[] };

export async function vendorIdentity(db: pg.ClientBase): Promise<VendorIdentity> {
  const { rows } = await db.query<{ v: VendorIdentity | null }>(`select vendor_identity() as v`);
  if (!rows[0]?.v) throw new VendorProfileError("vendor profile missing");
  return rows[0].v;
}

// A rendered field: receipts, templates and legal pages show the text with the marker.
export type RenderedField = { text: string; placeholder: boolean; label: string };
export const PLACEHOLDER_LABEL = "contoh, belum diisi";
export function renderField(identity: VendorIdentity, field: VendorProfileField): RenderedField {
  const placeholder = identity.placeholders.includes(field);
  const text = identity[field];
  return { text, placeholder, label: placeholder ? `${text} (${PLACEHOLDER_LABEL})` : text };
}

// The message never carries the reasons (residency posture is operator-only).
export class GoLiveBlockedError extends Error {
  constructor() {
    super("production go-live blocked by the vendor profile");
  }
}

// Operator only (vendor console, T-021): the detailed reasons.
export async function goLiveBlockers(op: pg.ClientBase): Promise<string[]> {
  const { rows } = await op.query<{ b: string[] }>(`select vendor_go_live_blockers() as b`);
  return rows[0].b;
}

// DEL-3 environments. Only an explicit non-production deployment is exempt; anything
// else, including a missing or unknown value, counts as production (fails closed).
export type DeployEnv = "production" | "staging" | "demo" | "local";
export function deployEnv(env: Partial<Record<string, string>> = process.env): DeployEnv {
  const v = env.DEPLOY_ENV;
  return v === "staging" || v === "demo" || v === "local" ? v : "production";
}

// Staging, demo and local run on synthetic data (MIG-2) and are never blocked here.
export async function assertProductionGoLive(db: pg.ClientBase, env: DeployEnv = deployEnv()): Promise<void> {
  if (env !== "production") return;
  const { rows } = await db.query<{ ok: boolean }>(`select vendor_go_live_allowed() as ok`);
  if (!rows[0]?.ok) throw new GoLiveBlockedError();
}

const TEXT_RULES: Record<VendorProfileField, RegExp> = {
  legal_name: /^(PT|CV|Koperasi|Yayasan|Perum|Persero) [\p{L}\p{N}][\p{L}\p{N} .,&'()-]{1,119}$/u,
  nib: /^[0-9]{13}$/,
  pse_number: /^[0-9A-Za-z./-]{4,60}$/,
  npwp: /^[0-9]{15,16}$/,
  meta_business_id: /^[0-9]{5,25}$/,
  website: /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/,
  privacy_url: /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/,
  support_email: /^[^\s@]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/,
  support_phone: /^\+62[0-9]{8,13}$/,
};

export type StorageLocation = { kind: (typeof STORAGE_KINDS)[number]; provider: string; region: string; country: string };

export type ProfileUpdate = Partial<Record<VendorProfileField, string>> & {
  storageLocations?: StorageLocation[];
};

function requireOwner(actor: VendorActor) {
  if (actor.vendorRole !== "platform_owner") throw new VendorProfileError("only the platform owner edits the vendor profile");
}

async function inTx<T>(db: pg.ClientBase, fn: () => Promise<T>): Promise<T> {
  // A nested BEGIN only warns and the inner COMMIT would commit the caller's work early.
  if ((db as pg.Client).getTransactionStatus?.() !== "I") throw new VendorProfileError("call outside an open transaction");
  await db.query("begin");
  try {
    const r = await fn();
    await db.query("commit");
    return r;
  } catch (e) {
    await db.query("rollback").catch(() => undefined); // keep the original error
    throw e;
  }
}

const COLUMNS = new Set<string>(VENDOR_PROFILE_FIELDS);

// Replaces fields with real values (validated) and clears their placeholder marks.
export async function updateProfile(db: pg.ClientBase, actor: VendorActor, update: ProfileUpdate, reason: string): Promise<void> {
  requireOwner(actor);
  const fields = Object.keys(update).filter((k) => k !== "storageLocations") as VendorProfileField[];
  for (const f of fields) {
    if (!COLUMNS.has(f)) throw new VendorProfileError(`unknown field ${f}`);
    const raw = update[f];
    if (typeof raw !== "string") throw new VendorProfileError(`invalid ${f}`);
    const v = raw.trim();
    // Any bracket is a placeholder marker; invisible characters are never valid.
    if (!TEXT_RULES[f].test(v) || /[[\]]/.test(v) || /[\u200b-\u200f\u2060\ufeff]/.test(v)) {
      throw new VendorProfileError(`invalid ${f}`);
    }
  }
  validateReason(reason);
  if (update.storageLocations) validateLocations(update.storageLocations);
  await inTx(db, async () => {
    const before = (await db.query(`select * from vendor_profile where id = 1 for update`)).rows[0];
    if (!before) throw new VendorProfileError("vendor profile missing");
    for (const f of fields) {
      const v = update[f]!.trim();
      if (before[f] === v && !before.placeholder_fields.includes(f)) continue;
      await db.query(
        `update vendor_profile set ${f} = $1, placeholder_fields = array_remove(placeholder_fields, $2), updated_at = now() where id = 1`,
        [v, f],
      );
      await logChange(db, actor, f, before[f], v, reason);
    }
    if (update.storageLocations) {
      await db.query(`update vendor_profile set storage_locations = $1::jsonb, updated_at = now() where id = 1`, [
        JSON.stringify(update.storageLocations),
      ]);
      await logChange(db, actor, "storage_locations", before.storage_locations, update.storageLocations, reason);
    }
  });
}

function validateLocations(locs: StorageLocation[]) {
  for (const l of locs) {
    if (!(STORAGE_KINDS as readonly string[]).includes(l.kind)) throw new VendorProfileError(`unknown storage kind ${l.kind}`);
    if (!/^[A-Z]{2}$/.test(l.country)) throw new VendorProfileError("country must be ISO 3166-1 alpha-2");
    if (!/^[\w .-]{2,60}$/.test(l.provider) || !/^[\w .-]{2,60}$/.test(l.region)) throw new VendorProfileError("invalid provider or region");
  }
}

// H-02d: the product owner records the written legal opinion (reference, date, outcome)
// and the checksum of the opinion file; a later opinion replaces it, and both stay in
// the change log.
export async function setResidencyOpinion(
  db: pg.ClientBase,
  actor: VendorActor,
  opinion: { ref: string; date: string; outcome: "positive" | "negative"; file: Buffer },
  reason: string,
): Promise<void> {
  requireOwner(actor);
  validateReason(reason);
  if (!/^[\w ./-]{3,80}$/.test(opinion.ref)) throw new VendorProfileError("invalid opinion reference");
  if (!isPastOrTodayDate(opinion.date)) throw new VendorProfileError("invalid date");
  // A written opinion: at least a page of content, never an empty or token file.
  if (opinion.file.length < 1024) throw new VendorProfileError("opinion file is too small");
  const checksum = createHash("sha256").update(opinion.file).digest("hex");
  await inTx(db, async () => {
    const before = (await db.query(
      `select residency_opinion_ref, residency_opinion_date::text, residency_opinion_outcome, residency_opinion_checksum
         from vendor_profile where id = 1 for update`,
    )).rows[0];
    if (!before) throw new VendorProfileError("vendor profile missing");
    await db.query(
      `update vendor_profile set residency_opinion_ref = $1, residency_opinion_date = $2, residency_opinion_outcome = $3,
              residency_opinion_set_by = $4, residency_opinion_checksum = $5, updated_at = now() where id = 1`,
      [opinion.ref, opinion.date, opinion.outcome, actor.accountId, checksum],
    );
    await logChange(db, actor, "residency_opinion", before, { ref: opinion.ref, date: opinion.date, outcome: opinion.outcome, checksum }, reason);
  });
}

function validateReason(reason: string) {
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 500) {
    throw new VendorProfileError("a reason of 3–500 characters is required");
  }
}

// Strict calendar date (Date.parse accepts 2026-02-31), not in the future.
function isPastOrTodayDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === v && d.getTime() <= Date.now();
}

async function logChange(db: pg.ClientBase, actor: VendorActor, field: string, oldValue: unknown, newValue: unknown, reason: string) {
  await db.query(
    `insert into vendor_profile_changes (actor_account_id, actor_role, field, old_value, new_value, reason)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [actor.accountId, actor.vendorRole, field, JSON.stringify(oldValue ?? null), JSON.stringify(newValue ?? null), reason],
  );
}
