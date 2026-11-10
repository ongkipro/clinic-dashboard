// Private clinical media (PR-32, CLIN-015, CLIN-021, CLIN-026; T-055). Every call runs inside withTenantContext;
// the database decides who may upload, read and remove. Bytes go to the MediaStore (the database store in M2);
// access is only through a short-lived token: a random 32-byte value shown once to the caller, of which the
// database keeps only the sha256 (≤ 10 minutes, bound to the staff and acting role, access re-checked at use).
// Idempotency records hold ids and metadata only — never bytes or a raw token.
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import { MEDIA_MAX_BYTES, type MEDIA_KINDS, type PHOTO_ANGLES } from "../schema";
import { sniff } from "./image";
import { dbMediaStore, type MediaStore } from "./store";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);

export class MediaError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new MediaError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, fn: (c: pg.ClientBase) => Promise<T>) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, fn));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type MediaKind = (typeof MEDIA_KINDS)[number];
export type PhotoAngle = (typeof PHOTO_ANGLES)[number];
export const TOKEN_DEFAULT_SECONDS = 300;
export const TOKEN_MAX_SECONDS = 600;
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// ── Upload ───────────────────────────────────────────────────────────────────────────────────────
export type MediaInput = {
  visitId: string; kind: MediaKind; angle?: PhotoAngle; fileName: string; bytes: Buffer; takenAt?: Date; examinationId?: string;
};
// The type and pixel size come from the bytes; a photo must be a PNG or JPEG. The bytes are stored first (the
// same bytes twice are stored once), then the metadata names them.
export async function addMedia(db: pg.ClientBase, key: string, m: MediaInput, store: MediaStore = dbMediaStore) {
  if (!Buffer.isBuffer(m.bytes) || m.bytes.length < 1 || m.bytes.length > MEDIA_MAX_BYTES) throw new MediaError("ERR_INVALID_INPUT", "size");
  const s = sniff(m.bytes);
  if (!s || (m.kind === "photo" && s.contentType === "application/pdf")) throw new MediaError("ERR_INVALID_INPUT", "type");
  const hash = sha256(m.bytes);
  const meta: Record<string, Json> = {
    kind: m.kind, sha256: hash, content_type: s.contentType, size_bytes: m.bytes.length, file_name: m.fileName,
    ...(m.kind === "photo" && "width" in s ? { angle: m.angle ?? null, width: s.width, height: s.height } : {}),
    ...(m.takenAt ? { taken_at: m.takenAt.toISOString() } : {}),
    ...(m.examinationId ? { examination_id: m.examinationId } : {}),
  };
  const out = await command<{ media_id: string; sha256: string; object_key: string }>(db, "media_add", key, { visit_id: m.visitId, media: meta }, async (c) => {
    const { objectKey } = await store.put(c, { sha256: hash, contentType: s.contentType, bytes: m.bytes });
    const id = (await c.query(`select media_add($1, $2::jsonb) as r`, [m.visitId, JSON.stringify(meta)])).rows[0].r as string;
    return { media_id: id, sha256: hash, object_key: objectKey };
  });
  return { mediaId: out.result.media_id, objectKey: out.result.object_key, replayed: out.replayed };
}

export async function removeMedia(db: pg.ClientBase, key: string, mediaId: string, reason: string) {
  const out = await command(db, "media_remove", key, { media_id: mediaId, reason }, async (c) => {
    await c.query(`select media_remove($1, $2)`, [mediaId, reason]);
    return null;
  });
  return { replayed: out.replayed };
}

// ── Tokens (PR-32, SEC-2) ────────────────────────────────────────────────────────────────────────
// Returns the raw token once; the database keeps its sha256. A replay of the same key cannot return the token
// again (it is not stored): it fails as a conflict, and the caller asks for a new link.
export async function issueToken(db: pg.ClientBase, key: string, mediaId: string, purpose: "view" | "download", ttlSeconds = TOKEN_DEFAULT_SECONDS) {
  const token = randomBytes(32).toString("base64url");
  const out = await command<{ token_id: string; expires_at: string }>(db, "media_token_issue", key, { media_id: mediaId, purpose, ttl_seconds: ttlSeconds }, async (c) =>
    (await c.query(`select media_token_issue($1, $2, $3, $4) as r`, [mediaId, purpose, sha256(token), ttlSeconds])).rows[0].r);
  if (out.replayed) throw new MediaError("ERR_IDEMPOTENCY_CONFLICT", "token_shown_once");
  return { token, tokenId: out.result.token_id, expiresAt: new Date(out.result.expires_at) };
}

export type Served = { mediaId: string; purpose: "view" | "download"; contentType: string; fileName: string; bytes: Buffer };
// Opens a link: the caller's own live token, access re-checked now; audited view or download. Not idempotent
// by design (every opening is a use and an audit row).
export async function redeemToken(db: pg.ClientBase, token: string, store: MediaStore = dbMediaStore): Promise<Served> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new MediaError("ERR_NOT_FOUND", "link");
  const tokenHash = sha256(token);
  const r = (await call(() => db.query(`select media_token_redeem($1) as r`, [tokenHash]))).rows[0].r as Record<string, string | number>;
  const bytes = await call(() => store.get(db, { tokenHash, objectKey: r.object_key as string }));
  if (sha256(bytes) !== r.sha256) throw new MediaError("ERR_NOT_FOUND", "integrity");
  return { mediaId: r.media_id as string, purpose: r.purpose as Served["purpose"], contentType: r.content_type as string, fileName: r.file_name as string, bytes };
}

// ── Readers ──────────────────────────────────────────────────────────────────────────────────────
export type MediaRow = {
  id: string; visit_id: string; branch_id: string; examination_id?: string; kind: MediaKind; angle?: PhotoAngle; content_type: string;
  size_bytes: number; width?: number; height?: number; file_name: string; taken_at: string; uploaded_by: string; uploaded_as: "bc" | "doctor" | "nurse";
};
export async function listMedia(db: pg.ClientBase, patientId: string, visitId: string | null = null): Promise<MediaRow[]> {
  return (await call(() => db.query(`select media_list($1, $2) as r`, [patientId, visitId]))).rows[0].r as MediaRow[];
}

export type CompareReason = "angle_differs" | "angle_not_in_protocol" | "aspect_differs" | "time_too_close";
export type Comparison = {
  status: "comparable" | "warning"; comparable: boolean; reasons: CompareReason[];
  earlier: { id: string; angle: PhotoAngle; taken_at: string; width: number; height: number };
  later: { id: string; angle: PhotoAngle; taken_at: string; width: number; height: number };
};
// CLIN-015: whether two photos can be compared, with the reasons when not; never a score.
export async function compareMedia(db: pg.ClientBase, a: string, b: string): Promise<Comparison> {
  return (await call(() => db.query(`select media_compare($1, $2) as r`, [a, b]))).rows[0].r as Comparison;
}
