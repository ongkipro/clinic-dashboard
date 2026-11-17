// The mock AutoLaris port (T-103): in-process, scripted per call; nothing leaves the server (AGENTS: no live calls). A test scripts what each
// call returns and may run a hook inside the call (e.g. read the database to prove the reff_id was committed before the request, or pause
// after the provider "created" the transaction and before the answer is persisted).
import { advicePending, createQrisOk, createVaOk, listPaymentOk, SOURCE } from "./fixtures";
import type { AutolarisPort, CreatePayment, Exchange } from "./port";

type Kind = "list" | "create" | "advice";
export type MockAutolaris = AutolarisPort & {
  source: typeof SOURCE;
  calls: { kind: Kind; reffId?: string; transactionId?: string }[];
  next(kind: Kind, x: Exchange | ((arg: CreatePayment | string | undefined) => Exchange | Promise<Exchange>)): void;
  during(kind: Kind, hook: (arg: CreatePayment | string | undefined) => Promise<void>): void;
  count(kind: Kind): number;
};

export function mockAutolarisPort(): MockAutolaris {
  const script = new Map<Kind, (Exchange | ((arg: CreatePayment | string | undefined) => Exchange | Promise<Exchange>))[]>();
  const hooks = new Map<Kind, ((arg: CreatePayment | string | undefined) => Promise<void>)[]>();
  const calls: MockAutolaris["calls"] = [];
  let seq = Math.floor(Math.random() * 1e9) * 1000; // a provider id unique across mock instances (UNIQUE provider_trx_id)
  const run = async (kind: Kind, arg: CreatePayment | string | undefined, fallback: () => Exchange): Promise<Exchange> => {
    const h = hooks.get(kind)?.shift();
    if (h) await h(arg);
    const s = script.get(kind)?.shift();
    const x = s === undefined ? fallback() : typeof s === "function" ? await s(arg) : s;
    return structuredClone(x);
  };
  return {
    source: SOURCE,
    calls,
    next(kind, x) {
      script.set(kind, [...(script.get(kind) ?? []), x]);
    },
    during(kind, hook) {
      hooks.set(kind, [...(hooks.get(kind) ?? []), hook]);
    },
    count: (kind) => calls.filter((c) => c.kind === kind).length,
    async listPayment() {
      calls.push({ kind: "list" });
      return run("list", undefined, listPaymentOk);
    },
    async createPayment(req) {
      calls.push({ kind: "create", reffId: req.reff_id });
      // unscripted: the guide-shaped answer for the chosen channel (QRIS → an EMVCo payload; otherwise a VA)
      return run("create", req, () => (req.channel_code === "QRIS" ? createQrisOk(String(++seq), Number(req.amount)) : createVaOk(String(++seq), Number(req.amount))));
    },
    async advice(transactionId) {
      calls.push({ kind: "advice", transactionId });
      return run("advice", transactionId, advicePending);
    },
  };
}
