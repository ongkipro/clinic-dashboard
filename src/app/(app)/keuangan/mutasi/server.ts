// Server loader for /keuangan/mutasi (Finance only per 19 §2.11 & nav.ts).
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { loadMutasiIn, parseMutasiFilters, type MutasiData } from "./data";

export type MutasiPageResult =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "ok"; data: MutasiData };

export async function loadMutasiPage(
  sp: Record<string, string | string[] | undefined>,
): Promise<MutasiPageResult> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  const ctx = rc.kind === "ok" ? rc.active.context : null;
  if (!ctx || ctx.actingRole !== "finance") return { kind: "forbidden" };

  const parsed = parseMutasiFilters(sp);
  if (!parsed.ok) return { kind: "not-found" };

  try {
    const data = await withTenantContext(await appPool(), ctx, (db) =>
      loadMutasiIn(db, parsed.filters),
    );
    return { kind: "ok", data };
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" };
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" };
    if (e instanceof CommandError && e.code === "ERR_INVALID_INPUT") return { kind: "not-found" };
    throw e;
  }
}
