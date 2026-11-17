// The AutoLaris port the app server uses for Bayar (T-103 increment 2). There is no live adapter: the mock (in-process, synthetic fixtures)
// only when DEPLOY_ENV is local; everywhere else null — the page then shows "Pembayaran belum tersedia" (no live AutoLaris call, no API key).
import "server-only";
import { deployEnv } from "../profile/profile";
import { mockAutolarisPort } from "./mock";
import type { AutolarisPort } from "./port";

let port: AutolarisPort | undefined;
export function billingPort(): AutolarisPort | null {
  if (deployEnv() !== "local") return null;
  port ??= mockAutolarisPort();
  return port;
}
