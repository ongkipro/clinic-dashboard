// App liveness probe (OBS-3, OBSERVABILITY.md): verifies the HTTP server process is alive.
// Serves APP_HOST only (enforced by src/lib/hosts.ts & src/proxy.ts); carries zero tenant,
// user, version, or environment data and never caches.
import { NextResponse } from "next/server";
import { connection } from "next/server";

export async function GET() {
  await connection();
  return NextResponse.json(
    { status: "ok" },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
