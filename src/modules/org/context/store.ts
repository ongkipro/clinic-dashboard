// Request-side context (PR-84): the session gates first, then the stored selection
// (httpOnly cookie, per device; 17: "the last choice is remembered per device"),
// re-validated on every request by activeContext(). Server only.
import "server-only";
import { cookies, headers } from "next/headers";
import type pg from "pg";
import { getAuth } from "../../../auth/instance";
import { openAppPool } from "../../../db/rls/pool";
import { type ActiveContext, activeContext, parseSelection, type Selection } from "./context";

export const CONTEXT_COOKIE = "clinic_context";

let pool: Promise<pg.Pool> | undefined;
export function appPool(): Promise<pg.Pool> {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL is required");
  pool ??= openAppPool({ connectionString: url, max: 5 }).catch((e) => {
    pool = undefined;
    throw e;
  });
  return pool;
}

export type RequestContext =
  | { kind: "ok"; accountId: string; active: ActiveContext; selection: Selection }
  | { kind: "redirect"; to: "/masuk" | "/aktifkan-2fa" | "/terkunci" }
  | { kind: "blocked"; accountId: string };

export async function storedSelection(): Promise<Selection> {
  return parseSelection((await cookies()).get(CONTEXT_COOKIE)?.value);
}

export async function requestContext(opts: { activity?: boolean } = {}): Promise<RequestContext> {
  const h = await headers(); // request-time first: nothing below runs at prerender
  const gate = await (await getAuth()).checkSession(h, opts);
  if (gate.gate === "anonymous") return { kind: "redirect", to: "/masuk" };
  if (gate.gate === "enrol_totp") return { kind: "redirect", to: "/aktifkan-2fa" };
  if (gate.gate === "locked") return { kind: "redirect", to: "/terkunci" };
  if (gate.gate !== "ok") return { kind: "redirect", to: "/masuk" }; // fail closed
  const selection = await storedSelection();
  const active = await activeContext(await appPool(), gate.userId, selection);
  return active ? { kind: "ok", accountId: gate.userId, active, selection } : { kind: "blocked", accountId: gate.userId };
}
