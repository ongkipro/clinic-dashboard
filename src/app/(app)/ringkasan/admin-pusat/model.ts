// Ringkasan Admin Pusat (UX-57, PR-33g; T-115). Pure model: raw configuration facts in, the home's sections out.
// PR-63 boundary: Admin Pusat configures branches, catalog, staff, settings drafts and the public site; this screen shows
// setup completeness, pending configuration and what waits for the Owner — never revenue, cash, commission, prices or any
// patient or clinical data. The types below carry counts, names of branches / staff / roles, and links only.
import type { ListState } from "../../../../components/templates/templates";

// Who decides an approval type first (APPROVAL_TYPES order); the Owner decides fallbacks only.
export const waitingFor = (approverRoles: readonly string[]) => approverRoles[0] ?? "owner";

// ── raw inputs (from existing readers; see data.ts) ─────────────────────────────────────────────────────────────────
export type CredentialLite = { staffId: string; state: "pending" | "verified" | "rejected" | "suspended" | "revoked"; kind: string; profession: string;
  validFrom: string; expiresOn: string | null; superseded: boolean };
export type Raw = {
  branches: { id: string; code: string; name: string; timezone: string; licenceComplete: boolean; published: boolean }[];
  hours: Record<string, number>; // branch id → weekly intervals
  rooms: Record<string, number>; // branch id → active rooms
  services: Record<string, string[]>; // branch id → offered item ids
  activeServiceIds: string[]; // services with an active commercial version (a normal price)
  staff: { staffId: string; name: string; active: boolean; roles: { role: string; branchIds: string[] }[] }[];
  credentials: CredentialLite[];
  invitationsPending: number;
  approvalsPending: { id: string; type: string; typeLabel: string; waitingFor: string }[]; // own pending requests (approvals_read: requester)
  roleRequestsPending: { id: string; staffName: string; role: string; change: "grant" | "revoke"; state: "pending" | "awaiting_confirmation" }[];
  today: Record<string, string>; // branch id → branch-local YYYY-MM-DD
};

// ── output ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type IssueKey = "jam" | "ruang" | "layanan" | "harga" | "staf" | "kredensial" | "izin";
export type Issue = { key: IssueKey; text: string; href: string };
export type BranchSetup = { id: string; name: string; code: string; timezone: string; published: boolean; issues: Issue[]; href: string };
export type Pending = { key: string; title: string; subtitle: string; href: string };
export type AdminHomeData = { branches: BranchSetup[]; pendingConfig: Pending[]; waitingOwner: Pending[] };
export type ScreenState<D> = Exclude<ListState, { kind: "rows" }> | { kind: "ready"; data: D };
export type AdminHomeProps = { state: ScreenState<AdminHomeData>; as?: "main" | "section" };

export const CLINICAL_ROLES = ["doctor", "nurse", "therapist", "pharmacist", "facility_head"];
export const ROLE_WORD: Record<string, string> = {
  owner: "Owner", admin_pusat: "Admin Pusat", finance: "Keuangan", facility_head: "Penanggung Jawab Klinik", records_officer: "Petugas Rekam Medis",
  auditor: "Auditor Internal", central_cs: "CS Pusat", marketing: "Marketing", purchasing: "Pembelian", manager: "Manajer", pharmacist: "Apoteker",
};
export const TZ: Record<string, string> = { "Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT" };

const nf = new Intl.NumberFormat("id-ID");
const n = (x: number) => nf.format(x);

// A verified STR and a verified permit of the same profession, both in force today (as licences.completeSet).
export function credentialsComplete(rows: CredentialLite[], today: string): boolean {
  const live = rows.filter((c) => !c.superseded && c.state === "verified" && c.validFrom <= today && (c.expiresOn === null || c.expiresOn >= today));
  return live.some((s) => s.kind === "str" && live.some((p) => p.kind !== "str" && p.profession === s.profession));
}

// PR-33g: what is missing per branch, in the order Admin Pusat fixes it. Copy follows the scenario ("Jam buka belum diisi").
export function assessBranch(raw: Raw, b: Raw["branches"][number]): BranchSetup {
  const base = `/pengaturan/cabang/${b.id}`;
  const issues: Issue[] = [];
  if ((raw.hours[b.id] ?? 0) === 0) issues.push({ key: "jam", text: "Jam buka belum diisi", href: `${base}#jam` });
  if ((raw.rooms[b.id] ?? 0) === 0) issues.push({ key: "ruang", text: "Ruang belum diisi", href: `${base}#ruang` });
  const offered = raw.services[b.id] ?? [];
  if (offered.length === 0) issues.push({ key: "layanan", text: "Layanan belum dipilih", href: `${base}#layanan` });
  else {
    const active = new Set(raw.activeServiceIds);
    const noPrice = offered.filter((id) => !active.has(id)).length;
    if (noPrice > 0) issues.push({ key: "harga", text: `${n(noPrice)} layanan belum punya harga aktif`, href: "/layanan" });
  }
  const here = raw.staff.filter((s) => s.active && s.roles.some((r) => r.branchIds.includes(b.id)));
  if (here.length === 0) issues.push({ key: "staf", text: "Belum ada staf", href: "/staf" });
  const today = raw.today[b.id] ?? "";
  const clinical = here.filter((s) => s.roles.some((r) => CLINICAL_ROLES.includes(r.role) && r.branchIds.includes(b.id)));
  const missing = clinical.filter((s) => !credentialsComplete(raw.credentials.filter((c) => c.staffId === s.staffId), today)).length;
  if (missing > 0) issues.push({ key: "kredensial", text: `${n(missing)} staf klinis kredensialnya belum lengkap`, href: "/staf?segmen=kredensial" });
  if (!b.licenceComplete) issues.push({ key: "izin", text: "Data izin belum lengkap", href: `${base}#izin` });
  return { id: b.id, name: b.name, code: b.code, timezone: b.timezone, published: b.published, issues, href: base };
}

// Admin Pusat drafts settings (Pengaturan) and catalog changes (Master Layanan); other types never reach this role.
export const approvalHref = (type: string) => (type.startsWith("setting_") ? "/pengaturan" : "/layanan");

const ROLE_REQUEST = { grant: "Pemberian peran", revoke: "Pencabutan peran" } as const;

export function assemble(raw: Raw): AdminHomeData {
  // Incomplete branches first (most issues first), then by name.
  const branches = raw.branches.map((b) => assessBranch(raw, b))
    .sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name, "id"));
  const waitingOwner: Pending[] = [
    ...raw.roleRequestsPending.map((r) => ({
      key: `role-${r.id}`, title: `${ROLE_REQUEST[r.change]} ${ROLE_WORD[r.role] ?? r.role} untuk ${r.staffName}`,
      subtitle: r.state === "awaiting_confirmation" ? "Menunggu konfirmasi staf" : "Menunggu persetujuan Owner", href: "/staf",
    })),
    ...raw.approvalsPending.filter((a) => a.waitingFor === "owner").map((a) => ({
      key: `ap-${a.id}`, title: a.typeLabel, subtitle: "Menunggu persetujuan Owner", href: approvalHref(a.type),
    })),
  ];
  const pendingConfig: Pending[] = [
    ...(raw.invitationsPending > 0 ? [{ key: "undangan", title: `${n(raw.invitationsPending)} undangan staf belum diterima`, subtitle: "Undangan", href: "/staf?segmen=undangan" }] : []),
    ...raw.approvalsPending.filter((a) => a.waitingFor !== "owner").map((a) => ({
      key: `ap-${a.id}`, title: a.typeLabel, subtitle: `Menunggu persetujuan ${ROLE_WORD[a.waitingFor] ?? a.waitingFor}`, href: approvalHref(a.type),
    })),
  ];
  return { branches, pendingConfig, waitingOwner };
}

// Admin Pusat home only (nav "AP"); every other role has its own home.
export const HOME_ROLE = "admin_pusat";
export const mayOpen = (role: string) => role === HOME_ROLE;

// The branch-local calendar date for a timezone.
export const localDate = (tz: string, now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
