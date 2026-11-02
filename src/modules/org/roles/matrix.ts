// The 07 role matrix as data (IAM-5, TEN-18). Parsed from docs/spec/07 by the readers
// test, so this file cannot drift from the spec. Each capability maps to the tables it
// reads; kind_readers(table) is the set of roles with ● or ◐ on any capability that
// reads it. Tables of tasks not built yet are added when they are.
import type { Role } from "../../../auth/policy";

export const MATRIX_ROLE_COLUMNS: Record<string, Role> = {
  Owner: "owner",
  "Admin Pusat": "admin_pusat",
  Manager: "manager",
  "Facility head": "facility_head",
  "Records officer": "records_officer",
  "FO/cashier": "fo_cashier",
  "Central CS": "central_cs",
  BC: "bc",
  Doctor: "doctor",
  Nurse: "nurse",
  Therapist: "therapist",
  Pharmacist: "pharmacist",
  Finance: "finance",
  Marketing: "marketing",
  Purchasing: "purchasing",
  Auditor: "auditor",
};

// Capability (07 row) -> tables it reads. Only tables that exist today.
export const CAPABILITY_TABLES: Record<string, string[]> = {
  "Staff & invitations": ["public.memberships", "public.staff", "public.staff_roles", "public.staff_branches", "public.role_requests"],
  "Audit log, data requests": ["public.audit_events"],
};

// Every member of a tenant may read these (a session needs its own tenant, branches,
// staff identity and its context actions); not a 07 capability.
export const EVERY_MEMBER_TABLES = ["public.tenants", "public.branches", "public.org_actions"];

// IAM-11: roles Admin Pusat assigns directly (Level 3, minus the owner-approval list);
// every other role it asks for waits for an owner. Nobody changes their own role set.
export const ADMIN_PUSAT_DIRECT_ROLES: readonly Role[] = [
  "manager",
  "fo_cashier",
  "bc",
  "doctor",
  "nurse",
  "therapist",
  "pharmacist",
];

export type Access = "full" | "limited" | "duty";
export type Matrix = Record<string, Partial<Record<Role, Access>>>;

export function parseMatrix(markdown: string): Matrix {
  const lines = markdown.split("\n").filter((l) => l.startsWith("| ") && l.split("|").length >= 19);
  const header = lines[0].split("|").slice(1, -1).map((c) => c.trim());
  const roles = header.slice(1).map((h) => {
    const r = MATRIX_ROLE_COLUMNS[h];
    if (!r) throw new Error(`unknown role column in 07: ${h}`);
    return r;
  });
  const out: Matrix = {};
  for (const line of lines.slice(2)) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const cap = cells[0];
    out[cap] = {};
    cells.slice(1).forEach((c, i) => {
      if (c.startsWith("●")) out[cap][roles[i]] = "full";
      // "◐ (if duty assigned)": access depends on a duty assignment (DATA-65, T-031);
      // until duties exist it grants nothing (fail closed).
      else if (c.startsWith("◐") && /duty assigned/.test(c)) out[cap][roles[i]] = "duty";
      else if (c.startsWith("◐")) out[cap][roles[i]] = "limited";
    });
  }
  return out;
}

export function readersByTable(matrix: Matrix): Map<string, Set<Role>> {
  const out = new Map<string, Set<Role>>();
  for (const [cap, tables] of Object.entries(CAPABILITY_TABLES)) {
    const row = matrix[cap];
    if (!row) throw new Error(`capability not in 07: ${cap}`);
    for (const t of tables) {
      const set = out.get(t) ?? new Set<Role>();
      for (const [r, a] of Object.entries(row) as [Role, Access][]) if (a !== "duty") set.add(r);
      out.set(t, set);
    }
  }
  return out;
}
