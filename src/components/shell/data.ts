// Server data for the clinic shell (NAV-3). Every request passes the T-006 gates
// (session, TOTP enrolment, idle lock) and the T-007 context resolution (TEN-1) before
// any clinic page renders.
import "server-only";
import { headers } from "next/headers";
import type pg from "pg";
import { getAuth } from "../../auth/instance";
import { openAppPool } from "../../db/rls/pool";
import { type ShellData, shellFor } from "./context";

let pool: Promise<pg.Pool> | undefined;
function appPool(): Promise<pg.Pool> {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL is required");
  pool ??= openAppPool({ connectionString: url, max: 5 }).catch((e) => {
    pool = undefined;
    throw e;
  });
  return pool;
}

export async function loadShell(): Promise<ShellData> {
  const h = await headers(); // request-time first: nothing below runs at prerender
  const gate = await (await getAuth()).checkSession(h);
  if (gate.gate === "anonymous") return { kind: "redirect", to: "/masuk" };
  if (gate.gate === "enrol_totp") return { kind: "redirect", to: "/aktifkan-2fa" };
  if (gate.gate === "locked") return { kind: "redirect", to: "/terkunci" };
  if (gate.gate !== "ok") return { kind: "redirect", to: "/masuk" }; // fail closed on anything new
  return shellFor(await appPool(), gate.userId);
}
