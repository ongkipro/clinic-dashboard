// Ekspor Data (UX-32, PR-52; T-122), pure view model.
// Owner-only ("Ekspor penuh hanya untuk Owner"); non-owners receive blocked state.
import { canDownload, EXPIRY_MS, STATES, type ExportState } from "../../../modules/export/export";

export const ROUTE = "/ekspor";

export type Job = {
  id: string;
  state: ExportState;
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
  fileCount: number | null;
  manifestSha256: string | null;
  downloads: number;
  errorCode: string | null;
  purgedAt: string | null;
  canDownload: boolean;
};

export type EksporModel =
  | { kind: "blocked"; reason: string; unblock: string }
  | { kind: "error" }
  | { kind: "ok"; jobs: Job[]; canStart: boolean; startBlocked: string | null; now: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[a-z][a-z0-9_]{1,48}$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export const OWNER_ONLY = {
  reason: "Ekspor penuh hanya untuk Owner",
  unblock: "Owner dapat memulai dan mengunduh ekspor",
} as const;

export function projectJob(v: unknown, now: Date): Job | null {
  const o = obj(v);
  const id = typeof o.id === "string" && UUID.test(o.id) ? o.id : null;
  const state = typeof o.state === "string" && (STATES as readonly string[]).includes(o.state) ? (o.state as ExportState) : null;
  const requestedAt = iso(o.requested_at ?? o.requestedAt);
  if (!id || !state || !requestedAt) return null;
  const completedAt = iso(o.completed_at ?? o.completedAt);
  const expiresAt = completedAt ? new Date(Date.parse(completedAt) + EXPIRY_MS).toISOString() : null;
  const rawExp = o.expires_at ?? o.expiresAt;
  if (rawExp != null && iso(rawExp) !== expiresAt) return null;
  const purgedAt = iso(o.purged_at ?? o.purgedAt);
  const sha = typeof (o.manifest_sha256 ?? o.manifestSha256) === "string" && HEX64.test(String(o.manifest_sha256 ?? o.manifestSha256))
    ? String(o.manifest_sha256 ?? o.manifestSha256)
    : null;
  const errRaw = o.error_code ?? o.errorCode;
  return {
    id,
    state,
    requestedAt,
    completedAt,
    expiresAt,
    sizeBytes: int(o.size_bytes ?? o.sizeBytes),
    fileCount: int(o.file_count ?? o.fileCount),
    manifestSha256: sha,
    downloads: int(o.download_count ?? o.downloadCount) ?? 0,
    errorCode: typeof errRaw === "string" && CODE.test(errRaw) ? errRaw : null,
    purgedAt,
    canDownload: canDownload(
      {
        state,
        completedAt: completedAt ? new Date(completedAt) : null,
        purgedAt: purgedAt ? new Date(purgedAt) : null,
      },
      now,
    ).ok,
  };
}

export function projectEkspor(o: { actingRole: string; reader: unknown; now: Date }): EksporModel {
  if (o.actingRole !== "owner") return { kind: "blocked", ...OWNER_ONLY };
  const r = obj(o.reader);
  if (!Array.isArray(r.jobs)) return { kind: "error" };
  const jobs = r.jobs
    .map((j) => projectJob(j, o.now))
    .filter((j): j is Job => j !== null)
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : a.requestedAt > b.requestedAt ? -1 : a.id < b.id ? 1 : -1));
  const inFlight = jobs.some((j) => j.state === "queued" || j.state === "running");
  return {
    kind: "ok",
    jobs,
    canStart: !inFlight,
    startBlocked: inFlight ? "Ekspor sedang berjalan. Tunggu sampai selesai" : null,
    now: o.now.toISOString(),
  };
}

export const STATE_LABEL: Record<ExportState, { label: string; tone: "neutral" | "warning" | "success" | "danger" | "locked" }> = {
  queued: { label: "Dalam antrean", tone: "neutral" },
  running: { label: "Sedang dibuat", tone: "warning" },
  ready: { label: "Siap diunduh", tone: "success" },
  failed: { label: "Gagal", tone: "danger" },
  expired: { label: "Kedaluwarsa", tone: "locked" },
};

export function size(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(v)} ${units[u]}`;
}

export const instant = (v: string): string =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(v));

export function remaining(expiresAt: string | null, now: string): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - Date.parse(now);
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)} jam lagi` : `${Math.max(min, 1)} menit lagi`;
}

export const downloadHref = (id: string): string => `${ROUTE}/${id}/unduh`;
