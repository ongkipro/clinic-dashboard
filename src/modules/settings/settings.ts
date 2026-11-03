// Settings registry server code (PR-38): the editor's view of a group, changes, restores,
// drafts and their decisions, and the value-in-force helper that transactions use to
// snapshot the value they applied (DATA-6). Runs on the caller's client inside
// withTenantContext; the setting_* functions (migration 0028) enforce scope, changers and
// bounds again in the database.
import type pg from "pg";
import type { Role } from "../../auth/policy";
import { CommandError, type ErrorCode } from "../../lib/command";
import { type GroupSlug, SETTING_BY_KEY, SETTINGS, type SettingDef } from "./registry";
import { type Invalid, validate, type Value } from "./spec";

const CODE = /^(ERR_[A-Z_]+):/;
const KNOWN = new Set<string>([
  "ERR_SETTING_NOT_ALLOWED", "ERR_SETTING_OUT_OF_BOUNDS", "ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_VERSION_CONFLICT", "ERR_APPROVER_IS_REQUESTER",
]);

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new CommandError(m[1] as ErrorCode);
    throw e;
  }
}

// A value outside the bounds, named (PR-38 "rejected naming the bound").
export class SettingBoundsError extends Error {
  constructor(readonly key: string, readonly invalid: Invalid) {
    super(invalid.message);
  }
}

// What a role may do with a row: change it, draft it for someone, or nothing (hidden).
export type Access = { mode: "change" } | { mode: "draft"; approver: "owner" | "facility_head" } | null;
export function accessFor(def: SettingDef, role: Role): Access {
  if (def.changers.includes(role)) return { mode: "change" };
  const d = def.drafts.find((x) => x.by === role);
  return d ? { mode: "draft", approver: d.approver } : null;
}

export type Version = {
  id: string;
  createdAt: Date;
  decidedAt: Date | null;
  previous?: Value; // the value in force just before this version took effect (active versions)
  branchId: string | null;
  value: Value;
  restoredDefault: boolean;
  effectiveFrom: Date;
  state: "active" | "draft" | "rejected" | "cancelled" | "superseded";
  changedName: string;
  changedAs: Role;
  reason: string;
  approvalId: string | null;
};

export type Row = {
  def: SettingDef;
  role: Role;
  access: NonNullable<Access>;
  inForce: Version | null; // the version in force now at this level (null = default)
  current: Value; // value in force now for the row's branch (value rows); null for ref rows
  isDefault: boolean; // current equals the researched default
  scheduled: Version | null; // an active version that takes effect later
  draft: Version | null; // a waiting draft
  history: Version[]; // newest first, at most 10
};

const toVersion = (r: Record<string, unknown>): Version => ({
  id: r.id as string,
  createdAt: r.created_at as Date,
  decidedAt: (r.decided_at as Date | null) ?? null,
  branchId: (r.branch_id as string | null) ?? null,
  value: r.value as Value,
  restoredDefault: r.restored_default === "yes",
  effectiveFrom: r.effective_from as Date,
  state: r.state as Version["state"],
  changedName: r.changed_name as string,
  changedAs: r.changed_as as Role,
  reason: r.reason as string,
  approvalId: (r.approval_id as string | null) ?? null,
});

// Structural equality (jsonb returns object keys in its own order).
const canon = (v: Value): Value =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : Array.isArray(v) ? v.map(canon) : v;
export const same = (a: Value, b: Value) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// One Pengaturan group as the acting role sees it: only the rows it may change or draft
// (19 §2.17). Branch-scoped rows show `branchId`'s value (its own, else the tenant value,
// else the default) and that branch's history; with branchId null they show the tenant
// value every branch without its own uses.
export async function groupRows(db: pg.ClientBase, role: Role, group: GroupSlug, branchId: string | null): Promise<Row[]> {
  const defs = SETTINGS.filter((d) => d.group === group).map((def) => ({ def, access: accessFor(def, role) })).filter((x) => x.access);
  const keys = defs.map((x) => x.def.key);
  if (keys.length === 0) return [];
  const { rows } = await db.query(
    `select id, key, branch_id, value, restored_default, effective_from, state, changed_name, changed_as, reason, approval_id, created_at, decided_at
       from setting_versions
      where key = any($1::text[]) and (branch_id is null or branch_id = $2)
      order by created_at desc, id desc`,
    [keys, branchId],
  );
  // The database clock decides what is in force (the app clock may drift).
  const now = (await db.query<{ t: Date }>(`select clock_timestamp() as t`)).rows[0].t;
  const current = await Promise.all(
    defs.map(async ({ def }) =>
      def.kind === "value" ? (await db.query(`select setting_value_at($1, $2, $3) as v`, [def.key, def.scope === "branch" ? branchId : null, now])).rows[0].v as Value : null,
    ),
  );
  return defs.map(({ def, access }, i) => {
    const level = def.scope === "tenant" ? null : branchId;
    const mine = rows.filter((r) => r.key === def.key && (r.branch_id ?? null) === level).map(toVersion);
    // "old → new" for active versions: the previous active version at this level by time
    // (else the default).
    const active = mine.filter((v) => v.state === "active").sort((a, b) => +a.effectiveFrom - +b.effectiveFrom);
    active.forEach((v, i) => (v.previous = i > 0 ? active[i - 1].value : def.kind === "value" ? def.default : null));
    return {
      def,
      role,
      inForce: [...active].reverse().find((v) => v.effectiveFrom <= now) ?? null,
      access: access!,
      current: current[i],
      isDefault: def.kind === "value" ? same(current[i], def.default) : true,
      scheduled: mine.find((v) => v.state === "active" && v.effectiveFrom > now) ?? null,
      draft: mine.find((v) => v.state === "draft") ?? null,
      history: mine.slice(0, 10),
    };
  });
}

export type ChangeInput = {
  key: string;
  branchId: string | null;
  value?: Value; // omitted when restoring
  restore?: boolean; // Kembalikan ke default
  effectiveFrom?: Date; // default now
  reason: string;
};

// Change, restore or draft one setting. Bounds are checked here first (the message names
// the bound) and again in the database. Returns whether it is in force or waiting.
export async function changeSetting(db: pg.ClientBase, c: ChangeInput): Promise<{ state: "active" | "draft"; versionId: string; approvalId?: string }> {
  const def = SETTING_BY_KEY.get(c.key);
  if (!def) throw new CommandError("ERR_SETTING_NOT_ALLOWED");
  if (def.kind !== "value") throw new CommandError("ERR_SETTING_NOT_ALLOWED");
  // An omitted value is not "off" (null): only a restore may leave it out.
  if (!c.restore && c.value === undefined) throw new SettingBoundsError(def.key, { path: "", message: `${def.label} belum diisi.` });
  const value = c.restore ? def.default : (c.value as Value);
  const bad = validate(def.spec, value, def.label);
  if (bad) throw new SettingBoundsError(def.key, bad);
  const r = await call(async () =>
    (await db.query(`select setting_set($1, $2, $3::jsonb, $4, $5, $6) as r`, [
      def.key, c.branchId, JSON.stringify(value), c.effectiveFrom ?? null, c.reason, Boolean(c.restore),
    ])).rows[0].r as { state: "active" | "draft"; version_id: string; approval_id?: string },
  );
  return { state: r.state, versionId: r.version_id, approvalId: r.approval_id };
}

// Decide or withdraw a waiting draft (Persetujuan for setting_change_* approvals).
export async function decideDraft(db: pg.ClientBase, approvalId: string, approve: boolean, reason?: string): Promise<"approved" | "rejected"> {
  return call(async () => (await db.query(`select setting_draft_decide($1, $2, $3) as s`, [approvalId, approve, reason ?? null])).rows[0].s);
}
export async function cancelDraft(db: pg.ClientBase, approvalId: string): Promise<void> {
  await call(() => db.query(`select setting_draft_cancel($1)`, [approvalId]));
}

// The value in force (DATA-6 snapshot helper): a transaction reads the value it applies
// through this in its own transaction and stores it (and the version time) on its row, so
// a later change never alters what an earlier sale or schedule used.
export async function settingValue<T extends Value = Value>(db: pg.ClientBase, key: string, branchId: string | null = null, at?: Date): Promise<T> {
  if (!SETTING_BY_KEY.has(key)) throw new CommandError("ERR_SETTING_NOT_ALLOWED");
  const { rows } = await db.query(`select setting_value_at($1, $2, coalesce($3::timestamptz, now())) as v`, [key, branchId, at ?? null]);
  return rows[0].v as T;
}
