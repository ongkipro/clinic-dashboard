// The mock Graph adapter (T-089; DEC-082: no live Meta call). It answers from the recorded fixtures and refuses to run in production (DEL-3: the
// payment port's rule). It makes no network call of any kind.
import { deployEnv } from "../../vendor/profile/profile";
import { EXCHANGE, FIXTURE_CODES, type FixtureCode, fixtureToken, REGISTER, STATUS, type StatusStep } from "./fixtures";
import type { WabaGraphPort } from "./port";

export class MockGraphUnavailableError extends Error {
  constructor() {
    super("the mock Graph adapter is not available in production");
  }
}
function guard() {
  if (deployEnv() === "production") throw new MockGraphUnavailableError();
}
const isFixture = (c: string): c is FixtureCode => (FIXTURE_CODES as readonly string[]).includes(c);
// A WABA this port instance has not exchanged: its recorded signup facts.
function fixtureBase(metaWabaId: string) {
  const r = Object.values(EXCHANGE).find((x) => x.metaWabaId === metaWabaId);
  return { verification: r?.businessVerificationStatus ?? "unverified", limit: r?.portfolioMessagingLimit ?? 250 };
}

// A mock with a controllable status step (tests move display names, quality and verification through it).
export function mockWabaGraphPort(o: { statusStep?: () => StatusStep } = {}): WabaGraphPort & { calls: string[] } {
  const calls: string[] = [];
  const known = new Map<string, { verification: "unverified" | "pending" | "verified"; limit: number }>();
  return {
    calls,
    async exchangeCode(i) {
      guard();
      calls.push("exchangeCode");
      if (!isFixture(i.code)) throw new Error("unknown recorded code");
      const r = EXCHANGE[i.code];
      known.set(r.metaWabaId, { verification: r.businessVerificationStatus, limit: r.portfolioMessagingLimit });
      return { ...r, accessToken: fixtureToken(i.code) };
    },
    async subscribeApp() {
      guard();
      calls.push("subscribeApp");
      return { subscribed: true };
    },
    async registerNumber(i) {
      guard();
      calls.push("registerNumber");
      return REGISTER(i.phoneNumberId, i.displayName);
    },
    async fetchWabaStatus(i) {
      guard();
      calls.push("fetchWabaStatus");
      const step = o.statusStep?.() ?? "approved";
      const base = known.get(i.metaWabaId) ?? fixtureBase(i.metaWabaId);
      const s = STATUS(step, base, i.phoneNumberIds);
      known.set(i.metaWabaId, { verification: s.businessVerificationStatus, limit: s.portfolioMessagingLimit });
      return s;
    },
  };
}
