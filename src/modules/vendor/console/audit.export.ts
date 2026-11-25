// T-129 + HYG-024 (RATE-5, SEC-16): Audited vendor action CSV export.
// - Rate-limited inside SQL (<= 5 exports / 5 min per account under advisory lock) with 10-minute step-up.
// - Hard sync cap <= 10,000 rows; client_ip masked in SQL (/24 for IPv4, 'masked' otherwise).
// - Neutralizes CSV spreadsheet formula injection (leading LF/CR/TAB, or leading whitespace + =, +, -, @) with RFC 4180 quoting.
import type pg from "pg";
import { withAuthorityRecheck } from "../authority";
import type { ConsoleCall } from "../tenants/tenants";
import type { ConsoleAnswer, VendorActionRow } from "./console";

const FORMULA_LEAD = /^[\t\r\n]|^\s*[=+\-@]/;

export function csvCell(raw: string | null | undefined): string {
  const s = raw ?? "";
  const safe = FORMULA_LEAD.test(s) ? `'${s}` : s;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

export function formatVendorActionsCsv(rows: readonly VendorActionRow[]): string {
  const header = "id,at,actor_role,action,tenant_id,tenant_name,outcome,reason_code,client_ip";
  const lines = rows.map((r) =>
    [
      csvCell(r.id),
      csvCell(r.at),
      csvCell(r.actorRole),
      csvCell(r.action),
      csvCell(r.tenantId),
      csvCell(r.tenantName),
      csvCell(r.outcome),
      csvCell(r.reasonCode),
      csvCell(r.clientIp),
    ].join(","),
  );
  return `${[header, ...lines].join("\r\n")}\r\n`;
}

export async function exportVendorActionsCsv(
  db: pg.Pool | pg.ClientBase,
  c: ConsoleCall,
  opts: { tenantId?: string | null; from?: string | null; to?: string | null } = {},
): Promise<ConsoleAnswer<{ count: number; csv: string; rows: VendorActionRow[] }>> {
  const tenant = opts.tenantId ?? null;
  return withAuthorityRecheck(db, c, "vendor_console_actions_export", { tenant }, async () => {
    type Raw =
      | { ok: true; count: number; rows: VendorActionRow[] }
      | { ok: false; code: string; reason: string; count?: number; max?: number };
    const r = await db.query<{ r: Raw }>(
      `select vendor_console_actions_export($1, $2, $3::uuid, $4::timestamptz, $5::timestamptz) as r`,
      [c.token, c.ip, tenant, opts.from ?? null, opts.to ?? null],
    );
    const out = r.rows[0].r;
    if (!out.ok) {
      return { ok: false, code: out.code, reason: out.reason, ...(out.count !== undefined ? { count: out.count, max: out.max } : {}) };
    }
    return { ok: true, data: { count: out.count, rows: out.rows, csv: formatVendorActionsCsv(out.rows) } };
  });
}
