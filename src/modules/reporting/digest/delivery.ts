// T-117 (PR-80) slice C1: the delivery seam of the owner digest — EMAIL only, through a mockable port (Panel 2 D1). No provider, no recipient
// address, no scheduler. Production refuses the mock (DEL-3, as the WABA / payment mocks).
// - The port receives a TYPED body: a subject and lines of free-text parts and numeric figures, kept structurally apart. The port renders the
//   text itself (renderLines) and scans the subject and the WHOLE rendered body with every forbidden-identifier pattern; a match is exempt
//   only if it lies wholly inside one figure span (bodyProblem / renderedIdentifier in digest.ts). Free text is never masked;
//   currency-shaped free text is never trusted as a figure. Recipients are SET-37 ROLES, never addresses.
// - In-app is NOT a channel here; WhatsApp stays gated (staff WABA / phone / template).
// - Delivery CONTRACT (narrowed; DESIGN-r5.md):
//     * The production adapter MUST pass `key` (digestKey: tenant · business date · channel) to the provider as its idempotency key, so the
//       PROVIDER deduplicates a repeated send of the same key. Exactly-once delivery is the provider's guarantee, not ours.
//     * Our side guarantees: at most one AUTHORIZED dispatch per lease generation (digest_dispatch, under the generation / lease / current
//       opt-in fence), a retry re-sends with the SAME key, and the database never records a false outcome — 'sent' only on a receipt (a
//       receipt wins over every closure); 'refused:*' ONLY if the run was never dispatched; 'unconfirmed:*' for every dispatched run without
//       a receipt, including a definitive port refusal after the first dispatch ("may have been delivered; an operator checks the
//       provider"). A late receipt upgrades 'unconfirmed:*' to 'sent'.
//     * sendEmail returns the provider's reference on acceptance, or a definitive refusal; a technical failure throws.
// - The mock below is an in-memory TEST DOUBLE. It deduplicates by key only within the store it is given (inject one store into several
//   instances to model a provider that honours the key); it claims nothing across processes.
// - Exception counts are composeDigest's: a count no reader gives stays "Belum tersedia" — this seam never fills a 0.
import { deployEnv } from "../../vendor/profile/profile";
import { bodyProblem, type Composed, type Line, type RecipientRole, RECIPIENT_ROLES, renderLines } from "./digest";

export type EmailDigest = { key: string; recipients: readonly RecipientRole[]; subject: string; lines: readonly Line[] };
export type DeliveryResult =
  | { kind: "sent"; key: string; recipients: RecipientRole[]; providerRef: string }
  | { kind: "refused"; key: string; reason: DeliveryRefusal };
export type DeliveryRefusal = "not_email" | "composed_refused" | "no_recipients" | "invalid_recipient" | "identifier_found" | "invalid_body";

export interface DigestDeliveryPort {
  sendEmail(d: EmailDigest): Promise<DeliveryResult>;
}

const KEY = /^[A-Za-z0-9_.:-]{8,128}$/;
const rolesProblem = (recipients: readonly unknown[]): DeliveryRefusal | null =>
  recipients.length === 0 ? "no_recipients"
  : recipients.some((r) => !(RECIPIENT_ROLES as readonly unknown[]).includes(r)) || new Set(recipients).size !== recipients.length ? "invalid_recipient" : null;

// What the worker hands the port, from a composed digest and the SET-37 roles. Refuses (never sends) anything that is not an email digest, has no
// or an unknown / duplicated recipient role, or a body the port would refuse.
export function emailDelivery(key: string, composed: Composed, recipients: readonly unknown[]): { ok: true; digest: EmailDigest } | { ok: false; reason: DeliveryRefusal } {
  if (!KEY.test(key)) throw new RangeError("invalid digest key");
  if (composed.kind !== "ok") return { ok: false, reason: "composed_refused" };
  if (composed.channel !== "email" || !composed.email) return { ok: false, reason: "not_email" };
  const r = rolesProblem(recipients);
  if (r) return { ok: false, reason: r };
  const b = bodyProblem(composed.email.subject, composed.email.lines);
  if (b) return { ok: false, reason: b };
  return { ok: true, digest: { key, recipients: recipients as RecipientRole[], subject: composed.email.subject, lines: composed.email.lines } };
}

export class MockDigestUnavailableError extends Error {
  constructor() {
    super("the mock digest delivery port is not available in production");
  }
}

// The in-memory test double. `store` models the provider's record honouring the idempotency key: a repeat of a key answers the first acceptance.
export type MockDigestStore = { outbox: { key: string; recipients: RecipientRole[]; subject: string; text: string; providerRef: string }[] };
export const mockDigestStore = (): MockDigestStore => ({ outbox: [] });
let refSeq = 0;
export function mockDigestDeliveryPort(store: MockDigestStore = mockDigestStore()): DigestDeliveryPort & { store: MockDigestStore } {
  return {
    store,
    async sendEmail(d) {
      if (deployEnv() === "production") throw new MockDigestUnavailableError();
      if (!KEY.test(d.key)) throw new RangeError("invalid digest key");
      const bad = rolesProblem(d.recipients) ?? bodyProblem(d.subject, d.lines);
      if (bad) return { kind: "refused", key: d.key, reason: bad };
      const seen = store.outbox.find((m) => m.key === d.key);
      if (seen) return { kind: "sent", key: d.key, recipients: [...seen.recipients], providerRef: seen.providerRef };
      const m = { key: d.key, recipients: [...d.recipients], subject: d.subject, text: renderLines(d.lines), providerRef: `mock-${++refSeq}` };
      store.outbox.push(m);
      return { kind: "sent", key: d.key, recipients: [...m.recipients], providerRef: m.providerRef };
    },
  };
}
