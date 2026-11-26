// Database readiness probe (OBS-3, OBSERVABILITY.md): verifies PostgreSQL connectivity
// through the non-owner clinic_app pool (TEN-2). Serves APP_HOST only; exposes zero
// tenant rows, error strings, stack traces, or environment details.
import { NextResponse } from "next/server";
import { connection } from "next/server";
import { appPool } from "../../../../modules/org/context/store";
import { probeDatabase } from "./check";

export async function GET() {
  await connection();
  if (!process.env.APP_DATABASE_URL) {
    return NextResponse.json(
      { status: "error", check: "db" },
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
  const result = await probeDatabase(appPool);
  return NextResponse.json(
    { status: result.ok ? "ok" : "error", check: "db" },
    {
      status: result.ok ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
