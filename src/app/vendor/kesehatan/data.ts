// Konsol Vendor › Kesehatan Platform data (UX-45, PR-62; T-118). One call: vendor_console_health(token, ip) as clinic_vendor (no table
// privilege), behind vendor_guard for platform_owner and support with the authority re-check (HYG-008b) — through the shared console
// `call`, which logs a re-check refusal in its own transaction. The reader returns aggregates only; the page projects them (model.ts).
import "server-only";
import { call, type ConsoleCall, type Result } from "../../../modules/vendor/tenants/tenants";
import { vendorPool } from "../_lib/server";

export const readHealth = async (c: ConsoleCall): Promise<Result<Record<string, unknown>>> =>
  call<Record<string, unknown>>(await vendorPool(), `select vendor_console_health($1, $2) as r`, [c.token, c.ip], { tenant: null });
