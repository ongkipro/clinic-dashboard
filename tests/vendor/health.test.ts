// T-118 (PR-62, UX-45, OBS-2–OBS-4; R3) — Konsol Vendor › Kesehatan Platform.
// Slice 1 (now, no database): the allowlist projection of the reader's JSON, error-code sanitising, the OBS-4 thresholds, the Option A
// "Belum terpantau" sources, filters and every page state, and the rendered view (Scenario PR-62's "no patient name or message text"
// against a reader that leaks sentinels). Slice 2 (drizzle/0127_vendor_health.sql): the reader on PostgreSQL as clinic_vendor — Scenario
// PR-62 with seeded content sentinels and a recursive key allowlist, roles, grants, isolation, the clock and re-check structure.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VENDOR_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { bootstrapVendor, createVendorStaff } from "../../src/modules/vendor/staff/staff";
import { createHarness, type Harness, testPool } from "../rls/harness";
import {
  duration, failureRate, filterHref, HEALTH_ROLES, NOT_MEASURED, OBS4, parseFilter, projectHealth, PROVIDERS, resolveView, safeCode, statusOf,
  visible, type ProviderRow,
} from "../../src/app/vendor/kesehatan/model";
import { HealthView } from "../../src/app/vendor/kesehatan/view";

const A = "0193a000-0000-7000-8000-00000000000a";
const B = "0193a000-0000-7000-8000-00000000000b";
const SENTINEL = {
  patient: "Pasien Sentinel Rahasia", phone: "6281299990000", body: "Isi pesan WhatsApp sentinel", payload: "payload sentinel {\"nik\":\"3171\"}",
  error: "Patient Budi has HIV — Bundle invalid at Condition.code", orderRef: "ORD-SENTINEL-77", amount: 1234567,
};
// What a careless reader could return: everything outside the allowlist must vanish.
const raw = (over: Record<string, unknown> = {}) => ({
  at: "2026-11-19T03:00:00Z",
  tenants: [
    { id: A, name: "PT Klinik Sintetis A", state: "live", patient_name: SENTINEL.patient,
      providers: {
        outbox: { open: 3, oldest_seconds: 120, failed_1h: 0, failed_24h: 0, codes: [], last_activity: null },
        whatsapp: { open: 7, oldest_seconds: 1_200, failed_1h: 1, failed_24h: 4, contact_wa_id: SENTINEL.phone, body: SENTINEL.body,
          codes: [{ code: "token_unavailable", count: 3 }, { code: SENTINEL.error, count: 1 }, { code: "TypeError", count: 2 }], last_activity: "2026-11-19T02:58:00Z" },
        satusehat: { open: 2, oldest_seconds: 60, failed_1h: 3, attempts_1h: 20, failed_24h: 5, error_path: "Condition.code", body: SENTINEL.error,
          codes: [{ code: "http_4xx", count: 3 }, { code: "invalid", count: 0 }], last_activity: "2026-11-19T02:59:00Z" },
        payment_webhook: { open: 0, failed_24h: 1, order_ref: SENTINEL.orderRef, amount: SENTINEL.amount, codes: [{ code: "rejected_signature", count: 1 }] },
        meta_webhook: { open: 0, oldest_seconds: null, failed_24h: 0, raw_payload_enc: SENTINEL.payload, codes: [] },
      } },
    { id: B, name: "PT Klinik Sintetis B", state: "suspended", providers: {} },
  ],
  platform: { unrouted: 2, wal_archived_at: null, wal_failed_at: null, wal_readable: false, pg_settings: "secret" },
  not_measured: ["uptime", "worker_heartbeat", "backup_age", "error_rate", "bogus"],
  ...over,
});
const ok = (r: unknown) => resolveView({ allowed: true, read: { ok: true, raw: r }, filter: parseFilter({}) });
const html = (r: unknown, f = {}) => renderToStaticMarkup(HealthView({ state: resolveView({ allowed: true, read: { ok: true, raw: r }, filter: parseFilter(f) }) }));
const row = (p: Partial<ProviderRow>): ProviderRow => ({ provider: "whatsapp", open: { kind: "count", value: 0 }, oldestSeconds: null, failed1h: { kind: "count", value: 0 },
  failed24h: { kind: "count", value: 0 }, attempts1h: { kind: "none" }, deadLetter: { kind: "none" }, codes: [], lastActivity: null, ...p });

describe("allowlist projection (PR-60, PR-62)", () => {
  it("keeps only the allowlisted keys; no sentinel survives the projection", () => {
    const p = projectHealth(raw());
    if (p.kind !== "ok") throw new Error("invalid");
    const text = JSON.stringify(p.health);
    for (const s of Object.values(SENTINEL)) expect(text, String(s)).not.toContain(String(s));
    const keys = new Set<string>();
    const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); } };
    walk(p.health);
    expect([...keys].sort()).toEqual([
      "at", "attempts1h", "code", "codes", "count", "deadLetter", "failed1h", "failed24h", "id", "kind", "lastActivity", "name", "notMeasured", "oldestSeconds", "open",
      "platform", "provider", "providers", "state", "tenants", "unrouted", "value", "walArchivedAt", "walFailedAt", "walReadable",
    ]);
  });
  it("every tenant has every provider in order; a missing provider is 'none', never 0", () => {
    const p = projectHealth(raw());
    if (p.kind !== "ok") throw new Error("invalid");
    for (const t of p.health.tenants) expect(t.providers.map((x) => x.provider)).toEqual([...PROVIDERS]);
    const b = p.health.tenants.find((t) => t.id === B)!;
    expect(b.providers[0].open).toEqual({ kind: "none" });
  });
  it("malformed input is invalid (error state), not an empty page", () => {
    for (const bad of [null, {}, raw({ at: "kemarin" }), raw({ tenants: "x" }), raw({ tenants: [{ id: "x", state: "live" }] }), raw({ tenants: [{ id: A, state: "deleted" }] })]) {
      expect(projectHealth(bad), JSON.stringify(bad).slice(0, 60)).toEqual({ kind: "invalid" });
    }
  });
});

describe("error codes: strict pattern or 'lainnya'", () => {
  it("free text, spaces, punctuation, overlong and non-strings become lainnya; codes are merged and capped at 5", () => {
    expect(safeCode("token_unavailable")).toBe("token_unavailable");
    expect(safeCode("http_4xx")).toBe("http_4xx");
    expect(safeCode("ERR_FORBIDDEN")).toBe("ERR_FORBIDDEN");
    for (const bad of [SENTINEL.error, "a", "x".repeat(50), "bad code", "<script>", "kode/123", 42, null, ""]) expect(safeCode(bad), String(bad)).toBe("lainnya");
    const p = projectHealth(raw({ tenants: [{ id: A, name: "X", state: "live", providers: { whatsapp: { codes: [
      { code: "a b", count: 2 }, { code: "c d", count: 3 }, { code: "k1", count: 1 }, { code: "k2", count: 1 }, { code: "k3", count: 1 }, { code: "k4", count: 1 }, { code: "k5", count: 1 }] } } }] }));
    if (p.kind !== "ok") throw new Error("invalid");
    expect(p.health.tenants[0].providers[1].codes).toEqual([{ code: "lainnya", count: 5 }, { code: "k1", count: 1 }, { code: "k2", count: 1 }, { code: "k3", count: 1 }, { code: "k4", count: 1 }]);
  });
});

describe("OBS-4 thresholds", () => {
  it("backlog older than 15 minutes is an alert; exactly 15 minutes is not", () => {
    expect(OBS4.backlogSeconds).toBe(900);
    expect(statusOf(row({ oldestSeconds: 901 })).tone).toBe("alert");
    expect(statusOf(row({ oldestSeconds: 900 })).tone).toBe("ok");
  });
  it("SATUSEHAT failures over 5 % per hour is an alert (other providers: the rate is not an OBS-4 alert)", () => {
    const s = row({ provider: "satusehat", failed1h: { kind: "count", value: 3 }, attempts1h: { kind: "count", value: 20 } }); // 15 %
    expect(failureRate(s)).toBeCloseTo(0.15);
    expect(statusOf(s)).toEqual({ tone: "alert", reasons: ["Gagal 15% dalam 1 jam (> 5%)"] });
    expect(statusOf({ ...s, failed1h: { kind: "count", value: 1 } }).tone).toBe("ok"); // 5 % exactly is not over
    expect(statusOf({ ...s, provider: "whatsapp" }).tone).toBe("ok");
    expect(failureRate(row({ provider: "satusehat", attempts1h: { kind: "count", value: 0 } }))).toBeNull();
  });
  it("failures in 24 h without an alert is a warning; no data is 'none'", () => {
    expect(statusOf(row({ failed24h: { kind: "count", value: 2 } })).tone).toBe("warning");
    expect(statusOf(row({ open: { kind: "none" }, failed24h: { kind: "none" } })).tone).toBe("none");
    // r2 #2: a current dead letter (outbox) is actionable whatever its age; an outbox with no dead letter and no 24-hour metric is ok, not "none"
    expect(statusOf(row({ provider: "outbox", deadLetter: { kind: "count", value: 2 }, failed24h: { kind: "none" } }))).toEqual({ tone: "warning", reasons: ["2 habis percobaan (surat mati)"] });
    expect(statusOf(row({ provider: "outbox", deadLetter: { kind: "count", value: 0 }, failed24h: { kind: "none" } })).tone).toBe("ok");
  });
  it("durations in Indonesian", () => {
    expect([duration(45), duration(1_200), duration(3_900), duration(200_000)]).toEqual(["45 detik", "20 menit", "1 jam 5 menit", "2 hari"]);
  });
});

describe("Option A: the sources without data are 'Belum terpantau', never a number", () => {
  it("the four keys are always reported, even if the reader omits them; unknown keys are dropped", () => {
    const p = projectHealth(raw({ not_measured: [] }));
    if (p.kind !== "ok") throw new Error("invalid");
    expect(p.health.notMeasured).toEqual([...NOT_MEASURED]);
  });
  it("renders Belum terpantau with the reason; no 0 % / 100 % uptime and no fake backup age", () => {
    const h = html(raw());
    for (const k of NOT_MEASURED) expect(h).toMatch(new RegExp(`data-metric="${k}" data-state="not_measured"`));
    expect(h.match(/Belum terpantau/g)!.length).toBeGreaterThanOrEqual(5); // 4 sources + WAL unreadable
    expect(h).toContain("Proses worker belum berjalan");
    expect(h).not.toMatch(/100%|0%\s*<\/|uptime 0/i);
  });
});

describe("Scenario PR-62 (rendered): counts and ages are shown, no patient name or message text", () => {
  const h = html(raw());
  it("shows counts, ages, codes and the OBS-4 status", () => {
    expect(h).toContain("PT Klinik Sintetis A");
    expect(h).toMatch(/data-provider="whatsapp" data-tone="alert"/); // 20 minutes > 15
    expect(h).toContain("20 menit");
    expect(h).toContain("token_unavailable (3)");
    expect(h).toContain("lainnya (1)");
    expect(h).toContain("3 / 20"); // SATUSEHAT failed / attempts in 1 h
  });
  it("no sentinel anywhere in the markup", () => {
    for (const s of Object.values(SENTINEL)) expect(h, String(s)).not.toContain(String(s));
  });
  it("a hostile tenant name is text", () => {
    const x = html(raw({ tenants: [{ id: A, name: `<img src=x onerror="alert(1)">`, state: "live", providers: {} }] }));
    expect(x).not.toContain("<img");
  });
});

describe("filters, roles and states", () => {
  it("roles are exactly platform owner and support (19 §3, IAM-10)", () => {
    expect([...HEALTH_ROLES]).toEqual(["platform_owner", "support"]);
  });
  it("provider and attention filters; hrefs round-trip; unknown values ignored", () => {
    expect(parseFilter({ penyedia: "satusehat", perlu: "1" })).toEqual({ provider: "satusehat", attention: true });
    expect(parseFilter({ penyedia: "__proto__", perlu: "ya" })).toEqual({ provider: null, attention: false });
    expect(filterHref({ provider: "satusehat", attention: true })).toBe("/vendor/kesehatan?penyedia=satusehat&perlu=1");
    expect(filterHref({ provider: null, attention: false })).toBe("/vendor/kesehatan");
    const p = projectHealth(raw());
    if (p.kind !== "ok") throw new Error("invalid");
    expect(visible(p.health, { provider: "satusehat", attention: false }).every((t) => t.providers.length === 1)).toBe(true);
    expect(visible(p.health, { provider: null, attention: true }).map((t) => t.id)).toEqual([A]); // B has no data
  });
  it("permission, error, empty, filtered-empty, ok — one at a time", () => {
    const r = (s: Parameters<typeof HealthView>[0]["state"]) => renderToStaticMarkup(HealthView({ state: s }));
    expect(r(resolveView({ allowed: false, read: { ok: true, raw: raw() }, filter: parseFilter({}) }))).toContain("Anda tidak memiliki akses ke Kesehatan Platform.");
    const err = resolveView({ allowed: true, read: { ok: false }, filter: parseFilter({}) });
    expect(err).toEqual({ kind: "error" });
    expect(r(err)).toMatch(/role="alert".*Data kesehatan belum dapat dimuat\..*Coba Lagi/);
    expect(ok(raw({ tenants: [] })).kind).toBe("empty");
    expect(r(ok(raw({ tenants: [] })))).toContain("Belum ada klinik.");
    const fe = resolveView({ allowed: true, read: { ok: true, raw: raw({ tenants: [{ id: B, name: "B", state: "live", providers: {} }] }) }, filter: parseFilter({ perlu: "1" }) });
    expect(fe.kind).toBe("filtered-empty");
    expect(r(fe)).toMatch(/Tidak ada klinik untuk filter ini\..*Hapus Filter/);
    expect(ok(raw()).kind).toBe("ok");
    expect(ok({ nope: 1 })).toEqual({ kind: "error" });
  });
});

// ── PostgreSQL: vendor_console_health (drizzle/0127_vendor_health.sql) as clinic_vendor ───────────────────────────────────────
// Fixture rows are written raw by the migration owner (h.admin); the FK triggers are off for the provider rows only (replica role:
// a WhatsApp message needs template / WABA / conversation rows, a SATUSEHAT attempt a link and a visit — none of which the reader
// reads). The tables' own guards are ENABLE ALWAYS, so every row still enters as the guard allows (queued first, outcome set once).
const IP = "203.0.113.10";
const HCAPS = { open: 0, oldest_seconds: 0, failed_1h: 0, failed_24h: 0, attempts_1h: 0, dead_letter: 0, codes: 0, last_activity: 0 };
const ALLOWED_KEYS: Record<string, readonly string[]> = {
  root: ["ok", "at", "tenants", "platform", "not_measured"],
  tenant: ["id", "name", "state", "providers"],
  providers: [...PROVIDERS],
  provider: Object.keys(HCAPS),
  code: ["code", "count"],
  platform: ["unrouted", "wal_readable", "wal_archived_at", "wal_failed_at"],
};
// Every object key in the reader's JSON, by position, must be on the allowlist (a new key fails here before it reaches a screen).
function keyViolations(r: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const check = (o: unknown, kind: string, path: string) => {
    if (o === null || typeof o !== "object" || Array.isArray(o)) return;
    for (const k of Object.keys(o)) if (!ALLOWED_KEYS[kind].includes(k)) bad.push(`${path}.${k}`);
  };
  check(r, "root", "$");
  check(r.platform, "platform", "$.platform");
  for (const [i, t] of ((r.tenants as Record<string, unknown>[] | undefined) ?? []).entries()) {
    check(t, "tenant", `$.tenants[${i}]`);
    const ps = (t.providers ?? {}) as Record<string, Record<string, unknown>>;
    check(ps, "providers", `$.tenants[${i}].providers`);
    for (const [p, v] of Object.entries(ps)) {
      check(v, "provider", `$.tenants[${i}].providers.${p}`);
      for (const [j, c] of ((v?.codes as unknown[] | undefined) ?? []).entries()) check(c, "code", `$.tenants[${i}].providers.${p}.codes[${j}]`);
    }
  }
  return bad;
}
const DB_SENTINEL = {
  phone: "6281299990000", error: "Pasien Budi Sentinel HIV — Bundle invalid", path: "Condition.code.sentinel", orderRef: "ORD-SENTINEL-77",
  amount: "1234567", payload: "v1.1.SentinelPayloadAbc.def.ghi", body: "Isi pesan sentinel", tenantB: "PT Klinik Sintetis B",
};

describe("vendor_console_health on PostgreSQL", () => {
  let h: Harness;
  let op: pg.Pool;
  let vendor: pg.Pool;
  let n = 0;
  const acct = async (totp = true) =>
    (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, $2) returning id`, [`sehat${++n}@vendor-sintetis.test`, totp])).rows[0].id as string;
  const session = async (acc: string, mfaAgo = "0 minutes") => {
    const tok = `tok${++n}${randomBytes(12).toString("hex")}`;
    await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now() - $3::interval)`, [acc, tok, mfaAgo]);
    return tok;
  };
  const read = async (tok: string) => (await vendor.query(`select vendor_console_health($1, $2) r`, [tok, IP])).rows[0].r as Record<string, unknown>;
  const actions = async () => (await h.admin.query(`select action, outcome, reason_code from vendor_actions where action = 'health_read' order by seq`)).rows;
  let PO: string, SUP: string, FIN: string, ONB: string, AUD: string;
  let A: { id: string; branch: string }, B: { id: string; branch: string };
  const tenant = async (name: string, state: string) => {
    const id = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [id, name]);
    const branch = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'K1', 'Cabang Satu', 'Asia/Jakarta') returning id`, [id])).rows[0].id as string;
    return { id, branch };
  };

  beforeAll(async () => {
    h = await createHarness();
    vendor = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 2 }, VENDOR_GROUP_ROLE);
    op = testPool({ connectionString: h.ownerUrl(), max: 1 });
    const c = await op.connect();
    try {
      PO = await acct();
      await bootstrapVendor(c, PO, "Rani Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
      const caller = { accountId: PO, ip: IP, mfaAt: new Date() };
      SUP = await acct(); FIN = await acct(); ONB = await acct(); AUD = await acct();
      await createVendorStaff(c, caller, SUP, "Dewi Dukungan", ["support"]);
      await createVendorStaff(c, caller, FIN, "Keuangan Vendor", ["vendor_finance"]);
      await createVendorStaff(c, caller, ONB, "Sari Onboarding", ["onboarding"]);
      await createVendorStaff(c, caller, AUD, "Auditor Vendor", ["vendor_auditor"]);
    } finally {
      c.release();
    }
  }, 120_000);
  afterAll(async () => {
    await vendor?.end();
    await op?.end();
    await h?.close();
  });

  it("an empty database: no tenant, zero unrouted, WAL not readable, the four not_measured keys — never an error", async () => {
    const r = await read(await session(PO));
    expect(r).toMatchObject({ ok: true, tenants: [], platform: { unrouted: 0, wal_readable: false, wal_archived_at: null, wal_failed_at: null },
      not_measured: ["uptime", "worker_heartbeat", "backup_age", "error_rate"] });
    expect(keyViolations(r)).toEqual([]);
    expect(resolveView({ allowed: true, read: { ok: true, raw: r }, filter: parseFilter({}) }).kind).toBe("empty");
  });

  it("Scenario PR-62: tenant A's outbox backlog — counts and ages from the fixture; B's rows never in A's row; no content", async () => {
    A = await tenant("PT Klinik Sintetis A", "live");
    B = await tenant(DB_SENTINEL.tenantB, "suspended");
    await h.admin.query(`insert into event_consumers (name, event_types, max_attempts) values ('health.probe', '{HealthProbe}', 3)`);
    // Outbox: 3 open receipts, the oldest 20 minutes old; one has used up its attempts (failed).
    for (const ago of ["20 minutes", "5 minutes", "1 minute"]) {
      await h.admin.query(`insert into domain_events (tenant_id, type, aggregate_kind, aggregate_id, occurred_at) values ($1, 'HealthProbe', 'probe', gen_random_uuid(), now() - $2::interval)`, [A.id, ago]);
    }
    await h.admin.query(`update event_receipts set attempts = 3 where id = (select r.id from event_receipts r join domain_events e on e.id = r.event_id where r.tenant_id = $1 order by e.occurred_at limit 1)`, [A.id]);
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      const wa = (t: { id: string; branch: string }, k: string, ago: string) => h.admin.query(
        `insert into outbound_messages (tenant_id, branch_id, purpose, category, template_id, patient_id, waba_id, wa_number_id, conversation_id, contact_wa_id,
           source_kind, source_id, planned_for, command_key, created_at)
         values ($1, $2, 'care_reminder', 'utility', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), $3,
           'appointment', gen_random_uuid(), (now() at time zone 'Asia/Jakarta')::date, $4, now() - $5::interval) returning id`, [t.id, t.branch, DB_SENTINEL.phone, `health-${k}-${randomBytes(4).toString("hex")}`, ago]);
      for (const [k, ago] of [["q1", "30 minutes"], ["q2", "2 minutes"]] as const) await wa(A, k, ago);
      const failed = [(await wa(A, "f1", "40 minutes")).rows[0].id, (await wa(A, "f2", "40 minutes")).rows[0].id];
      await h.admin.query(`update outbound_messages set state = 'sending', claimed_at = now() - interval '10 minutes', attempt_count = 1 where id = any($1)`, [failed]);
      await h.admin.query(`update outbound_messages set state = 'failed', decided_at = now() - interval '10 minutes', error_code = case when id = $2 then 'token_unavailable' else $3 end where id = any($1)`,
        [failed, failed[0], DB_SENTINEL.error]);
      for (let i = 0; i < 4; i++) await wa(B, `b${i}`, "50 minutes"); // B's backlog: never counted in A's row
      // SATUSEHAT: 1 queued (10 min), 1 held; 20 attempts in the last hour, 3 failed (one with a free-text code and path).
      await h.admin.query(`insert into satusehat_outbox (tenant_id, branch_id, visit_id, revision, exam_version_id, created_at) values ($1, $2, gen_random_uuid(), 1, gen_random_uuid(), now() - interval '10 minutes')`, [A.id, A.branch]);
      await h.admin.query(`insert into satusehat_outbox (tenant_id, branch_id, visit_id, revision, exam_version_id, state, hold_reason) values ($1, $2, gen_random_uuid(), 1, gen_random_uuid(), 'held', 'room_missing')`, [A.id, A.branch]);
      await h.admin.query(`insert into satusehat_attempts (tenant_id, link_id, outbox_id, revision, lease_gen, verb, started_at)
                           select $1, gen_random_uuid(), gen_random_uuid(), 1, 1, 'read', now() - make_interval(mins => g) from generate_series(1, 20) g`, [A.id]);
      await h.admin.query(`update satusehat_attempts a set finished_at = a.started_at, outcome = case when x.n <= 3 then 'http_4xx' else 'ok' end,
                             error_code = case when x.n = 1 then $2 when x.n <= 3 then 'invalid_bundle' end, error_path = case when x.n = 1 then $3 end
                             from (select id, row_number() over (order by started_at) n from satusehat_attempts where tenant_id = $1) x where x.id = a.id`, [A.id, DB_SENTINEL.error, DB_SENTINEL.path]);
    } finally {
      await h.admin.query("commit");
    }
    // Webhooks: one rejected payment webhook with an order reference and amount; a held Meta receipt with a sealed payload; one unrouted.
    await h.admin.query(`insert into payment_webhook_events (tenant_id, provider, provider_account, environment, provider_event_id, order_ref, amount, signature_ok, timestamp_ok, outcome, body_sha256)
                         values ($1, 'mock', 'acct', 'local', 'evt-1', $2, $3, false, true, 'rejected_signature', $4)`, [A.id, DB_SENTINEL.orderRef, DB_SENTINEL.amount, "a".repeat(64)]);
    await h.admin.query(`insert into meta_webhook_receipts (provider_event_id, kind, tenant_id, signature_ok, state, body_sha256, raw_payload_enc, payload_dek_ref, error_code)
                         values ('wamid.1', 'status', $1, true, 'held_out_of_order', $2, $3, 'dek:v1', 'status_before_message')`, [A.id, "b".repeat(64), DB_SENTINEL.payload]);
    await h.admin.query(`insert into meta_webhook_receipts (provider_event_id, kind, signature_ok, state, body_sha256) values ('wamid.2', 'message', true, 'dropped_unknown_route', $1)`, ["c".repeat(64)]);

    const r = await read(await session(PO));
    expect(keyViolations(r)).toEqual([]);
    const json = JSON.stringify(r);
    for (const s of Object.values(DB_SENTINEL).filter((x) => x !== DB_SENTINEL.tenantB)) expect(json, s).not.toContain(s);
    const tenants = r.tenants as { id: string; name: string; state: string; providers: Record<string, Record<string, unknown>> }[];
    expect(tenants.map((t) => [t.name, t.state])).toEqual([["PT Klinik Sintetis A", "live"], [DB_SENTINEL.tenantB, "suspended"]]);
    const a = tenants[0].providers;
    expect(a.outbox).toMatchObject({ open: 3, dead_letter: 1, failed_24h: null, codes: [{ code: "health.probe", count: 1 }] }); // r2 #2
    expect(a.outbox.oldest_seconds as number).toBeGreaterThanOrEqual(1200);
    expect(a.outbox.oldest_seconds as number).toBeLessThan(1260);
    expect(a.whatsapp).toMatchObject({ open: 2, failed_1h: 2, failed_24h: 2, attempts_1h: 2,
      codes: [{ code: "lainnya", count: 1 }, { code: "token_unavailable", count: 1 }] });
    expect(a.whatsapp.oldest_seconds as number).toBeGreaterThanOrEqual(1800);
    expect(a.whatsapp.oldest_seconds as number).toBeLessThan(1860);
    expect(a.satusehat).toMatchObject({ open: 2, failed_1h: 3, attempts_1h: 20, failed_24h: 3,
      codes: [{ code: "invalid_bundle", count: 2 }, { code: "lainnya", count: 1 }, { code: "room_missing", count: 1 }] });
    expect(a.satusehat.oldest_seconds as number).toBeGreaterThanOrEqual(600);
    expect(a.payment_webhook).toMatchObject({ failed_1h: 1, failed_24h: 1, codes: [{ code: "rejected_signature", count: 1 }] });
    expect(a.meta_webhook).toMatchObject({ open: 1, codes: [{ code: "status_before_message", count: 1 }] });
    expect(tenants[1].providers.whatsapp).toMatchObject({ open: 4 });
    expect((r.platform as Record<string, unknown>).unrouted).toBe(1);
    // the page: projected, alert on WhatsApp (30 min > 15) and SATUSEHAT (3 / 20 = 15 % > 5 %), no sentinel in the markup
    const markup = renderToStaticMarkup(HealthView({ state: resolveView({ allowed: true, read: { ok: true, raw: r }, filter: parseFilter({}) }) }));
    expect(markup).toMatch(/data-provider="whatsapp" data-tone="alert"/);
    expect(markup).toMatch(/data-provider="satusehat" data-tone="alert"/);
    expect(markup).toContain("3 / 20");
    for (const s of [DB_SENTINEL.phone, DB_SENTINEL.error, DB_SENTINEL.path, DB_SENTINEL.orderRef, DB_SENTINEL.payload]) expect(markup, s).not.toContain(s);
    expect((await actions()).at(-1)).toEqual({ action: "health_read", outcome: "success", reason_code: "list" });
  });

  it("roles: platform_owner and support read; onboarding, vendor_finance, vendor_auditor refused and logged; no session not logged; TOTP > 12 h refused", async () => {
    expect((await read(await session(SUP))).ok).toBe(true);
    for (const acc of [FIN, ONB, AUD]) {
      const before = (await actions()).length;
      expect(await read(await session(acc))).toEqual({ ok: false, code: "ERR_FORBIDDEN", reason: "role_not_held" });
      const after = await actions();
      expect(after.length).toBe(before + 1);
      expect(after.at(-1)).toEqual({ action: "health_read", outcome: "denied", reason_code: "role_not_held" });
    }
    const before = (await actions()).length;
    expect(await read(`nope${randomBytes(12).toString("hex")}`)).toEqual({ ok: false, code: "ERR_FORBIDDEN", reason: "no_session" });
    expect((await actions()).length).toBe(before);
    expect(await read(await session(PO, "13 hours"))).toEqual({ ok: false, code: "ERR_FORBIDDEN", reason: "totp_not_verified" });
    expect((await actions()).at(-1)).toEqual({ action: "health_read", outcome: "denied", reason_code: "totp_not_verified" });
    expect((await read(await session(PO, "11 hours"))).ok).toBe(true); // read-only page: the 12-hour factor, not the 10-minute step-up
  });

  it("grants: only clinic_vendor executes the reader; clinic_app, clinic_operator and clinic_executor get 42501; the helpers are executable by nobody", async () => {
    for (const group of ["clinic_app", "clinic_operator", "clinic_executor"]) {
      const pool = testPool({ connectionString: h.urlAs(await h.createLoginRole("", [group])), max: 1 });
      try {
        await expect(pool.query(`select vendor_console_health('x', 'y')`), group).rejects.toMatchObject({ code: "42501" });
      } finally {
        await pool.end();
      }
    }
    for (const f of [`vendor_health_code('x')`, `vendor_health_codes('{x}')`]) await expect(vendor.query(`select ${f}`), f).rejects.toMatchObject({ code: "42501" });
    const acl = (await h.admin.query(`select p.oid::regprocedure::text f, p.prosecdef d, p.proconfig c from pg_proc p where p.proname like 'vendor_health_code%' or p.proname = 'vendor_console_health' order by p.oid::regprocedure::text collate "C"`)).rows;
    expect(acl).toEqual([
      { f: "vendor_console_health(text,text)", d: true, c: ["search_path=pg_catalog, pg_temp"] },
      { f: "vendor_health_code(text)", d: false, c: ["search_path=pg_catalog, pg_temp"] },
      { f: "vendor_health_codes(text[])", d: false, c: ["search_path=pg_catalog, pg_temp"] },
    ]);
  });

  it("one clock read (HYG-016); the authority re-check right before the only success exit (HYG-008b); success logged before it", async () => {
    const def = (await h.admin.query(`select pg_get_functiondef('vendor_console_health(text,text)'::regprocedure) d`)).rows[0].d as string;
    expect(def.split("clock_timestamp()").length - 1).toBe(1);
    expect(def).not.toMatch(/\bnow\(\)|current_timestamp|statement_timestamp|transaction_timestamp/i);
    const body = def.slice(def.indexOf("IF g.refusal IS NOT NULL"));
    expect(body.match(/RETURN /g)).toHaveLength(2); // the refusal exit inside the IF, and RETURN r
    expect(body).toMatch(/PERFORM public\.vendor_log\([^)]*'health_read'[^)]*'success', 'list'[^)]*\);\s*PERFORM public\.vendor_authority_recheck\(p_token, p_ip, v_roles, interval '12 hours'\);\s*RETURN r;/);
  });

  it("the reader's guard and sanitiser as migrated: exactly platform_owner + support; the strict code pattern; WAL figures only while archiving", async () => {
    const def = (await h.admin.query(`select pg_get_functiondef('vendor_console_health(text,text)'::regprocedure) d`)).rows[0].d as string;
    expect(def).toContain("v_roles text[] := ARRAY['platform_owner','support'];");
    expect(def).toMatch(/vendor_guard\(v\.account_id, p_ip, v_roles, 'health_read', NULL, NULL, v\.second_factor_at, interval '12 hours'\)/);
    expect(def).not.toMatch(/patient_id|contact_wa_id|order_ref|raw_payload_enc|error_path|remote_id|body_fingerprint|provider_message_id|template_id|w\.amount/);
    const codes = (await h.admin.query(`select vendor_health_code(x) c from unnest(array['token_unavailable', 'http_4xx', 'a', '9abc', 'Bad code', $1::text, repeat('a', 50)]) x`, [DB_SENTINEL.error])).rows.map((x) => x.c);
    expect(codes).toEqual(["token_unavailable", "http_4xx", "lainnya", "lainnya", "lainnya", "lainnya", "lainnya"]);
    expect((await h.admin.query(`select vendor_health_codes(array['x1','x1','b2','c3','d4','e5','f6', null]) r`)).rows[0].r)
      .toEqual([{ code: "x1", count: 2 }, { code: "b2", count: 1 }, { code: "c3", count: 1 }, { code: "d4", count: 1 }, { code: "e5", count: 1 }]);
    // archive_mode is off in the test cluster: the archiver view is readable (no privilege error) and reported as not readable
    expect((await h.admin.query(`select current_setting('archive_mode') m`)).rows[0].m).toBe("off");
    expect((await read(await session(PO))).platform).toMatchObject({ wal_readable: false, wal_archived_at: null, wal_failed_at: null });
  });

  // ── r2 (independent review 1d2a370d; Panel 2 PANEL2-R1-REVIEW-DECISION) ──
  // #1 WhatsApp due backlog: the branch-local day of outbound_claim (0115: branch timezone, Jakarta fallback), at a fixed instant through
  // vendor_health_whatsapp(tenant, now) — 2026-11-20 16:30 UTC = 23:30 WIB (still the 20th), 00:30 WITA and 01:30 WIT (already the 21st).
  it("r2 #1: WhatsApp backlog uses the branch-local day — WITA / WIT messages planned for the 21st are due after their midnight; the Jakarta control is not", async () => {
    const NOW = "2026-11-20T16:30:00Z";
    const mk = async (name: string, tz: string) => {
      const id = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
      await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [id, name]);
      const branch = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'TZ1', 'Cabang Zona', $2) returning id`, [id, tz])).rows[0].id as string;
      return { id, branch };
    };
    const wita = await mk("PT Klinik Zona WITA", "Asia/Makassar");
    const wit = await mk("PT Klinik Zona WIT", "Asia/Jayapura");
    const wib = await mk("PT Klinik Zona WIB", "Asia/Jakarta");
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      const wa = (t: { id: string }, branch: string | null, planned: string) => h.admin.query(
        `insert into outbound_messages (tenant_id, branch_id, purpose, category, template_id, patient_id, waba_id, wa_number_id, conversation_id, contact_wa_id,
           source_kind, source_id, planned_for, command_key, created_at)
         values ($1, $2, 'care_reminder', 'utility', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '6281200000000',
           'appointment', gen_random_uuid(), $3, $4, $5::timestamptz - interval '40 minutes')`, [t.id, branch, planned, `tz-${randomBytes(6).toString("hex")}`, NOW]);
      await wa(wita, wita.branch, "2026-11-21");
      await wa(wit, wit.branch, "2026-11-21");
      await wa(wib, wib.branch, "2026-11-21");  // Jakarta is still the 20th → not due
      await wa(wib, null, "2026-11-21");        // no branch → the Jakarta fallback → not due
    } finally {
      await h.admin.query("commit");
    }
    const at = async (t: { id: string }) => (await h.admin.query(`select vendor_health_whatsapp($1, $2::timestamptz) r`, [t.id, NOW])).rows[0].r as Record<string, unknown>;
    // backlog age = since the message was created (40 min), not since it became due (30 min WITA / 90 min WIT)
    expect(await at(wita)).toMatchObject({ open: 1, oldest_seconds: 2400 });
    expect(await at(wit)).toMatchObject({ open: 1, oldest_seconds: 2400 });
    expect(await at(wib)).toMatchObject({ open: 0, oldest_seconds: null });
    // the attention state follows: WITA / WIT alert (40 min > 15), the Jakarta control is normal
    const tone = async (t: { id: string }) => {
      const wa = await at(t);
      const p = projectHealth({ at: NOW, tenants: [{ id: t.id, name: "x", state: "live", providers: { whatsapp: wa } }], platform: {}, not_measured: [] });
      if (p.kind !== "ok") throw new Error("invalid");
      return statusOf(p.health.tenants[0].providers.find((x) => x.provider === "whatsapp")!).tone;
    };
    expect([await tone(wita), await tone(wit), await tone(wib)]).toEqual(["alert", "alert", "ok"]);
    // the helper is internal: no application or vendor role executes it
    await expect(vendor.query(`select vendor_health_whatsapp($1, now())`, [wita.id])).rejects.toMatchObject({ code: "42501" });
    expect((await h.admin.query(`select p.prosecdef d, p.proconfig c from pg_proc p where p.oid = 'vendor_health_whatsapp(uuid,timestamptz)'::regprocedure`)).rows[0])
      .toEqual({ d: false, c: ["search_path=pg_catalog, pg_temp"] });
  });

  // #2 Outbox: an exhausted receipt is a current dead letter (stock), not a failure in the last 24 hours (no failure-time source exists)
  it("r2 #2: an exhausted receipt from days ago is a current dead letter; the outbox 24-hour failure count is not measured (null), never 0 or the stock", async () => {
    const id = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Surat Mati', 'emkm')`, [id]);
    await h.admin.query(`insert into domain_events (tenant_id, type, aggregate_kind, aggregate_id, occurred_at) values ($1, 'HealthProbe', 'probe', gen_random_uuid(), now() - interval '3 days')`, [id]);
    await h.admin.query(`update event_receipts set attempts = 3 where tenant_id = $1`, [id]);
    // a WhatsApp failure decided 2 days ago (outside the real 24-hour window) and one 2 hours ago (inside)
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      for (const ago of ["2 days", "2 hours"]) {
        const m = (await h.admin.query(
          `insert into outbound_messages (tenant_id, purpose, category, template_id, patient_id, waba_id, wa_number_id, conversation_id, contact_wa_id,
             source_kind, source_id, planned_for, command_key, created_at)
           values ($1, 'care_reminder', 'utility', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '6281200000000',
             'appointment', gen_random_uuid(), (now() at time zone 'Asia/Jakarta')::date - 3, $2, now() - interval '3 days') returning id`, [id, `dl-${randomBytes(6).toString("hex")}`])).rows[0].id;
        await h.admin.query(`update outbound_messages set state = 'sending', claimed_at = now() - $2::interval, attempt_count = 1 where id = $1`, [m, ago]);
        await h.admin.query(`update outbound_messages set state = 'failed', decided_at = now() - $2::interval, error_code = 'token_unavailable' where id = $1`, [m, ago]);
      }
    } finally {
      await h.admin.query("commit");
    }
    const r = await read(await session(PO));
    expect(keyViolations(r)).toEqual([]);
    const t = (r.tenants as { id: string; providers: Record<string, Record<string, unknown>> }[]).find((x) => x.id === id)!;
    expect(t.providers.outbox).toMatchObject({ open: 1, dead_letter: 1, failed_24h: null, failed_1h: null, codes: [{ code: "health.probe", count: 1 }] });
    // the other providers keep their real 24-hour windows (a WhatsApp failure decided 2 days ago is not in failed_24h)
    expect(t.providers.whatsapp).toMatchObject({ failed_24h: 1 });
    const markup = renderToStaticMarkup(HealthView({ state: resolveView({ allowed: true, read: { ok: true, raw: { ...r, tenants: [t] } }, filter: parseFilter({}) }) }));
    const outboxRow = markup.match(/<tr[^>]*data-provider="outbox"[^>]*>[\s\S]*?<\/tr>/)![0];
    expect(outboxRow).toMatch(/data-tone="alert"/);                   // still actionable (3 days open > 15 min) and the stock is named
    expect(outboxRow).toContain("1 habis percobaan (surat mati)");
    expect(outboxRow).toContain("Tidak diukur");                     // the 24-hour failure cell
    expect(outboxRow).not.toMatch(/gagal dalam 24 jam/);
    expect(markup).toMatch(/Gagal 24 jam<\/dt><dd>Tidak diukur<\/dd>/); // the narrow-layout card says the same
  });

  it("a tenant whose rows are all old or done reports zero, not missing: counts are numbers; ages null when nothing is open", async () => {
    const r = await read(await session(PO));
    const b = (r.tenants as { name: string; providers: Record<string, Record<string, unknown>> }[]).find((t) => t.name === DB_SENTINEL.tenantB)!;
    expect(b.providers.satusehat).toMatchObject({ open: 0, oldest_seconds: null, failed_1h: 0, attempts_1h: 0, failed_24h: 0, codes: [], last_activity: null });
    expect(b.providers.outbox).toMatchObject({ open: 0, oldest_seconds: null, dead_letter: 0, failed_24h: null, codes: [] });
    expect(b.providers.payment_webhook).toMatchObject({ open: null, failed_24h: 0, last_activity: null });
  });
});
