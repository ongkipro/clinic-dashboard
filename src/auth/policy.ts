// Staff sign-in policy (IAM-1, IAM-7, RATE-2, PR-3). Pure decisions; src/auth/server.ts
// wires them into Better Auth.

// Role keys follow the 07 matrix (one key per column). T-007 stores them in staff_roles.
export const ROLES = [
  "owner",
  "admin_pusat",
  "manager",
  "facility_head",
  "records_officer",
  "fo_cashier",
  "central_cs",
  "bc",
  "doctor",
  "nurse",
  "therapist",
  "pharmacist",
  "finance",
  "marketing",
  "purchasing",
  "auditor",
] as const;
export type Role = (typeof ROLES)[number];

// IAM-1 / PR-3: these roles need a verified TOTP before any tenant page or API is
// usable. Vendor roles (IAM-10) all need TOTP too; the vendor console (T-020/T-021)
// enforces that for vendor_staff accounts.
export const TOTP_ROLES: ReadonlySet<Role> = new Set([
  "owner",
  "admin_pusat",
  "manager",
  "doctor",
  "finance",
  "facility_head",
  "records_officer",
  "auditor",
  "central_cs",
]);

// IAM-7 / CD-10: fixed rule (class F, not a setting).
export const IDLE_LOCK_ROLES: ReadonlySet<Role> = new Set(["fo_cashier"]);
export const IDLE_LOCK_MS = 120_000;

// RATE-2: ≤ 5 failed password sign-ins per account per 15 minutes.
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;

// IAM-1: ≥ 15 characters and a blocklist. Better Auth caps the length at 128.
export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;

// Common and product-specific weak passwords (compared case-insensitively, after
// removing spaces). A breached-password service would send password hashes to a third
// party, which the no-SaaS rule (H-08) forbids; extend this list instead.
const BLOCKLIST = new Set([
  "passwordpassword",
  "password12345678",
  "123456789012345",
  "1234567890123456",
  "qwertyuiopasdfgh",
  "iloveyouiloveyou",
  "klinikkecantikan",
  "klinikcantik2026",
  "passwordklinik123",
  "adminadminadmin1",
  "rahasiarahasia12",
  "selamatdatang123",
]);

export function passwordProblem(password: string, email?: string): string | undefined {
  if (password.length < PASSWORD_MIN) return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
  if (password.length > PASSWORD_MAX) return `Kata sandi maksimal ${PASSWORD_MAX} karakter.`;
  const folded = password.toLowerCase().replace(/\s+/g, "");
  if (BLOCKLIST.has(folded)) return "Kata sandi ini terlalu umum. Pilih yang lain.";
  if (new Set(folded).size < 5) return "Kata sandi ini terlalu mudah ditebak. Pilih yang lain.";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && folded.includes(local)) {
    return "Kata sandi tidak boleh memuat alamat email Anda.";
  }
  return undefined;
}

export function requiresTotp(roles: readonly Role[]): boolean {
  return roles.some((r) => TOTP_ROLES.has(r));
}

export function hasIdleLock(roles: readonly Role[]): boolean {
  return roles.some((r) => IDLE_LOCK_ROLES.has(r));
}

// Session gate for every tenant page and API (PR-3 scenario): a TOTP role without an
// enrolled and verified second factor may reach only the enrolment flow.
export type SessionGate = "ok" | "enrol_totp" | "locked";

export function sessionGate(input: {
  roles: readonly Role[];
  twoFactorEnabled: boolean;
  lastActiveAt: Date;
  lockedAt: Date | null;
  now: Date;
}): SessionGate {
  if (requiresTotp(input.roles) && !input.twoFactorEnabled) return "enrol_totp";
  if (input.lockedAt) return "locked";
  if (hasIdleLock(input.roles) && input.now.getTime() - input.lastActiveAt.getTime() >= IDLE_LOCK_MS) {
    return "locked";
  }
  return "ok";
}

// Where each role set comes from. T-007 implements this from memberships/staff_roles
// (a login holds roles per tenant; the strictest rule across its memberships applies,
// so a person who is a doctor anywhere needs TOTP everywhere).
export type RoleSource = (userId: string) => Promise<readonly Role[]>;
