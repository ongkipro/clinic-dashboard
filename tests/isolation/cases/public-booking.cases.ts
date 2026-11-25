// DEL-2 cross-tenant negative cases for T-126 public booking routes & APIs (PR-67, UX-24, Finding #4).
// Covers: /[slug]/booking, /api/v1/public/booking/otp#route, /api/v1/public/booking/verify#route.
// Proves both negative isolation (Tenant A slug cannot request OTP for Tenant B's service/branch or
// redeem Tenant B's live OTP intent) AND live positive control (Tenant B succeeds on its own slug).
import type { Json } from "../../../src/lib/command";
import { withTenantContext } from "../../../src/db/rls/context";
import { assignBranch, assignRole, createMembership } from "../../../src/modules/org/identity";
import {
  getPublicBookingCatalog,
  getPublicBookingSlots,
  requestPublicBookingOtp,
  sha256Hex,
  verifyPublicBookingOtpAndBook,
} from "../../../src/modules/public-site/booking/db";
import { runPublicBookingPurge } from "../../../src/workers/public-booking-purge";
import { defineCases, type IsolationEnv } from "../case";
import { ensurePublishedSiteSeed } from "./situs.cases";

const asJson = (v: unknown): Json => JSON.parse(JSON.stringify(v)) as Json;
const LOCAL_ENV = { DEPLOY_ENV: "local" };
let caseSeq = 0;

function nextMondayDateStr(): string {
  const d = new Date(Date.now() + 7 * 3600_000);
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function ensureBookableSeed(env: IsolationEnv, tenantId: string, branchId: string) {
  const site = await ensurePublishedSiteSeed(env, tenantId, branchId);
  // Pick a Monday within the SET-16 30-day window that has no branch_closures from earlier isolation cases
  let slotDate = nextMondayDateStr();
  for (let week = 0; week < 3; week++) {
    const d = new Date(`${slotDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + week * 7);
    const cand = d.toISOString().slice(0, 10);
    const cl = await env.owner.query(
      `select 1 from branch_closures where tenant_id = $1 and branch_id = $2 and closed_on = $3::date limit 1`,
      [tenantId, branchId, cand],
    );
    if (cl.rowCount === 0) {
      slotDate = cand;
      break;
    }
  }

  await env.owner.query(
    `insert into branch_hours (tenant_id, branch_id, weekday, opens, closes)
     values ($1, $2, 1, '09:00', '17:00')
     on conflict (tenant_id, branch_id, weekday, opens) do update set closes = '17:00'`,
    [tenantId, branchId],
  );

  const roomCount = Number(
    (
      await env.owner.query(
        `select count(*) as c from rooms where tenant_id = $1 and branch_id = $2 and kind = 'treatment' and is_active = true`,
        [tenantId, branchId],
      )
    ).rows[0].c,
  );
  if (roomCount === 0) {
    await env.owner.query(
      `insert into rooms (tenant_id, branch_id, name, kind, is_active) values ($1, $2, 'Ruang Isolasi', 'treatment', true)`,
      [tenantId, branchId],
    );
  }

  const verRow = (
    await env.owner.query<{ id: string }>(
      `select cv.id from catalog_versions cv where cv.tenant_id = $1 and cv.item_id = $2 and cv.state = 'active' limit 1`,
      [tenantId, site.serviceItemId],
    )
  ).rows[0];

  const reqRoom = Number(
    (await env.owner.query(`select count(*) as c from service_resources where tenant_id = $1 and version_id = $2`, [tenantId, verRow.id])).rows[0].c,
  );
  if (reqRoom === 0) {
    await env.owner.query(
      `insert into service_resources (tenant_id, version_id, kind, code, required) values ($1, $2, 'room', 'treatment', true)`,
      [tenantId, verRow.id],
    );
  }

  const eligCount = Number(
    (await env.owner.query(`select count(*) as c from service_staff_eligibility where tenant_id = $1 and version_id = $2`, [tenantId, verRow.id])).rows[0].c,
  );
  if (eligCount === 0) {
    await env.owner.query(
      `insert into service_staff_eligibility (tenant_id, version_id, role, mode) values ($1, $2, 'therapist', 'performs')`,
      [tenantId, verRow.id],
    );
  }

  const shiftRows = await env.owner.query<{ staff_id: string }>(
    `select s.staff_id
       from staff_shifts s
       join staff_branches sb on sb.tenant_id = s.tenant_id and sb.staff_id = s.staff_id and sb.branch_id = s.branch_id and sb.role = 'therapist'
      where s.tenant_id = $1 and s.branch_id = $2 and s.shift_date = $3::date and s.kind = 'work'
      limit 1`,
    [tenantId, branchId, slotDate],
  );
  if (shiftRows.rowCount === 0) {
    const ownerRow = (
      await env.owner.query<{ staff_id: string }>(
        `select sr.staff_id from staff_roles sr where sr.tenant_id = $1 and sr.role = 'owner' limit 1`,
        [tenantId],
      )
    ).rows[0];
    const acc = (
      await env.owner.query<{ id: string }>(
        `insert into auth_user (name, email, two_factor_enabled) values ('Terapis Isolasi', $1, true) returning id`,
        [`therapist-iso-${tenantId.slice(0, 8)}-${++caseSeq}@pubbook.test`],
      )
    ).rows[0].id;
    const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Terapis Isolasi" });
    const c = await env.owner.connect();
    try {
      const rid = await assignRole(c, { tenantId, staffId, role: "therapist" });
      await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
    } finally {
      c.release();
    }
    await env.owner.query(
      `insert into staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by)
       values ($1, $2, $3, $4::date, '09:00', '17:00', 'work', $5)`,
      [tenantId, branchId, staffId, slotDate, ownerRow.staff_id],
    );
  }

  const slots = await getPublicBookingSlots(env.app, {
    slug: site.slug,
    treatmentSlug: site.treatmentSlug,
    branchSlug: site.branchSlug,
    date: slotDate,
  });
  if (slots.state !== "open" || slots.slots.length === 0) {
    throw new Error(`No bookable slot seeded for ${site.slug} on ${slotDate}`);
  }
  return { ...site, slotDate, slots: slots.slots };
}

export default defineCases(
  {
    kind: "route",
    id: "/[slug]/booking",
    expect: "filtered",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const v = await ensurePublishedSiteSeed(env, env.victim.tenantId, env.victim.branchId);
      const a = await ensurePublishedSiteSeed(env, env.actor.tenantId, env.actor.branchId);
      env.victimSecret(v.brandMarker);
      const res = await getPublicBookingCatalog(env.app, a.slug);
      return { status: res.state === "open" ? 200 : 404, body: asJson(res) };
    },
  },
  {
    kind: "route",
    id: "/api/v1/public/booking/otp#route",
    expect: "not-found",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const v = await ensureBookableSeed(env, env.victim.tenantId, env.victim.branchId);
      const a = await ensureBookableSeed(env, env.actor.tenantId, env.actor.branchId);
      env.victimSecret(v.brandMarker);
      const seq = ++caseSeq;
      const res = await requestPublicBookingOtp(
        env.app,
        {
          slug: a.slug,
          treatmentSlug: v.treatmentSlug,
          branchSlug: v.branchSlug,
          slotStartIso: v.slots[0].startsAt,
          sourceTag: "situs-perawatan",
          phoneE164: `+628123400${String(seq).padStart(4, "0")}`,
          patientName: "Pasien Isolasi OTP",
          birthDate: "1992-05-10",
          sex: "female",
          otpCode: "123456",
          intentToken: `iso-otp-${seq}-${env.actor.tenantId}`,
          clientIp: `198.51.100.${(seq % 200) + 10}`,
        },
        LOCAL_ENV,
      );
      if (res.state !== "otp_sent") return { status: 404, body: asJson(res) };
      const cat = await getPublicBookingCatalog(env.app, a.slug);
      return { status: 200, body: asJson({ otp: res, brand: cat.state === "open" ? cat.brand : null }) };
    },
  },
  {
    kind: "route",
    id: "/api/v1/public/booking/verify#route",
    expect: "not-found",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const v = await ensureBookableSeed(env, env.victim.tenantId, env.victim.branchId);
      const a = await ensureBookableSeed(env, env.actor.tenantId, env.actor.branchId);
      env.victimSecret(v.brandMarker);
      const seq = ++caseSeq;
      // Seed a live OTP intent belonging to the VICTIM tenant
      const victimToken = `iso-verify-victim-${seq}-${env.victim.tenantId}`;
      const seeded = await requestPublicBookingOtp(
        env.app,
        {
          slug: v.slug,
          treatmentSlug: v.treatmentSlug,
          branchSlug: v.branchSlug,
          slotStartIso: v.slots[Math.min(2, v.slots.length - 1)].startsAt,
          sourceTag: "situs-perawatan",
          phoneE164: `+628123500${String(seq).padStart(4, "0")}`,
          patientName: "Pasien Isolasi Verify",
          birthDate: "1994-06-15",
          sex: "female",
          otpCode: "654321",
          intentToken: victimToken,
          clientIp: `198.51.101.${(seq % 200) + 10}`,
        },
        LOCAL_ENV,
      );
      if (seeded.state !== "otp_sent") {
        throw new Error(`Failed to seed live victim OTP intent: ${JSON.stringify(seeded)}`);
      }
      // Attempt to redeem victim's live OTP intent through ACTOR's slug (404 when cross-tenant, 200 when own)
      const res = await verifyPublicBookingOtpAndBook(
        env.app,
        {
          slug: a.slug,
          intentToken: victimToken,
          otpCode: "654321",
          commandKey: `iso-verify-cmd-${seq}-${env.actor.tenantId}`,
        },
        LOCAL_ENV,
      );
      if (res.state !== "confirmed" && res.state !== "held") {
        return { status: 404, body: asJson(res) };
      }
      const cat = await getPublicBookingCatalog(env.app, a.slug);
      return { status: 200, body: asJson({ booking: res, brand: cat.state === "open" ? cat.brand : null }) };
    },
  },
  {
    kind: "job",
    id: "workers/public-booking-purge",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const v = await ensureBookableSeed(env, env.victim.tenantId, env.victim.branchId);
      env.victimSecret(v.brandMarker);
      const seq = ++caseSeq;
      const tok = `iso-purge-${seq}-${env.victim.tenantId}`;
      const seeded = await requestPublicBookingOtp(
        env.app,
        {
          slug: v.slug,
          treatmentSlug: v.treatmentSlug,
          branchSlug: v.branchSlug,
          slotStartIso: v.slots[Math.min(3, v.slots.length - 1)].startsAt,
          sourceTag: "situs",
          phoneE164: `+62812600${String(seq).padStart(4, "0")}`,
          patientName: "Pasien Purge Isolasi",
          birthDate: "1993-04-04",
          sex: "female",
          otpCode: "121212",
          intentToken: tok,
          clientIp: `198.51.102.${(seq % 200) + 10}`,
        },
        LOCAL_ENV,
      );
      if (seeded.state !== "otp_sent") throw new Error(`Seed failed: ${JSON.stringify(seeded)}`);
      const intentHash = sha256Hex(`intent:${tok}`);
      await env.owner.query(
        `update public_booking_intents set otp_expires_at = clock_timestamp() - interval '20 minutes' where tenant_id = $1 and intent_hash = $2`,
        [env.victim.tenantId, intentHash],
      );

      // Negative control (tenant A bound): calling public_booking_purge_expired from a tenant-bound session MUST be refused.
      if (env.actor.tenantId !== env.victim.tenantId) {
        const actorOwner = (
          await env.owner.query<{ staff_id: string }>(
            `select staff_id from staff_roles where tenant_id = $1 and role = 'owner' limit 1`,
            [env.actor.tenantId],
          )
        ).rows[0];
        let code = "done";
        try {
          await withTenantContext(
            env.app,
            { tenantId: env.actor.tenantId, staffId: actorOwner.staff_id, roles: ["owner"], allowedBranchIds: "*" },
            async (db) => {
              await db.query(`select public.public_booking_purge_expired(15)`);
            },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          code = msg.includes("ERR_FORBIDDEN") ? "ERR_FORBIDDEN" : "ERR_REFUSED";
        }
        return { attempts: { purge: code }, body: asJson({ refused: code !== "done" }) };
      }

      // Positive control (unbound worker purges victim's expired intent):
      const out = await runPublicBookingPurge(env.app, { graceMinutes: 15 });
      const row = (
        await env.owner.query<{ purged_at: Date | null }>(
          `select purged_at from public_booking_intents where tenant_id = $1 and intent_hash = $2`,
          [env.victim.tenantId, intentHash],
        )
      ).rows[0];
      const ok = out.purgedCount >= 1 && row?.purged_at !== null;
      return {
        attempts: { purge: ok ? "done" : "ERR_NOT_PURGED" },
        body: asJson({ purgedCount: out.purgedCount, brand: ok ? v.brandMarker : null }),
      };
    },
  },
);
