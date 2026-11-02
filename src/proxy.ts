// Host isolation (ARCH-3, SEC-21): every request is checked against the host resolver
// before any route renders. Refusals are a plain 404 with no body, the same for every
// reason, so a host never reveals routes that belong to another host.
import { NextResponse, type NextRequest } from "next/server";
import { type HostConfig, hostConfigFromEnv, resolveRequest } from "./lib/hosts";

// Read once per process. Outside production the three hosts default to loopback names
// (browsers resolve *.localhost to 127.0.0.1); production must configure all three
// (ARCH-9) and a bad configuration fails every request closed (500) until fixed.
let cached: HostConfig | undefined;
function config(): HostConfig {
  if (cached) return cached;
  const env = process.env;
  if (env.NODE_ENV !== "production" && !env.APP_HOST && !env.BOOKING_HOST && !env.VENDOR_HOST) {
    const port = env.PORT ?? "3000";
    cached = {
      app: `localhost:${port}`,
      booking: `booking.localhost:${port}`,
      vendor: `vendor.localhost:${port}`,
    };
  } else {
    cached = hostConfigFromEnv(env);
  }
  return cached;
}

export function proxy(request: NextRequest) {
  const decision = resolveRequest(config(), request.headers.get("host"), request.nextUrl.pathname);
  if (decision.allow) return NextResponse.next();
  return new NextResponse(null, {
    status: 404,
    headers: { "cache-control": "no-store", "x-host-policy": "refused" },
  });
}
