// DEL-2 cross-tenant negative cases for Situs Klinik admin & Kode Promo (/situs, /situs/promo; PR-64, PR-77; T-123).
import { createHash } from "node:crypto";
import type pg from "pg";
import { withTenantContext } from "../../../src/db/rls/context";
import { assignRole, createMembership } from "../../../src/modules/org/identity";
import { createPromoCode, listPromoCodes } from "../../../src/modules/promo/promo";
import {
  approvePublicWebReview,
  getPublicWebReviewSource,
  getSiteAdminView,
  publishPublicSite,
  savePublicWebField,
  saveSiteSettings,
} from "../../../src/modules/public-site";
import { defineCases, type IsolationEnv } from "../case";

type OwnerRow = { staffId: string; accountId: string };
type Seed = {
  slug: string;
  brandMarker: string;
  promoCode: string;
  serviceItemId: string;
  treatmentSlug: string;
  branchSlug: string;
};

const owners = new Map<string, OwnerRow>();
const seeded = new Map<string, Seed>();

export async function ensureSitusOwner(env: IsolationEnv, tenantId: string): Promise<OwnerRow> {
  const cached = owners.get(tenantId);
  if (cached) return cached;
  const existing = (
    await env.owner.query<{ staff_id: string; account_id: string }>(
      `select s.id as staff_id, m.account_id
         from staff s
         join memberships m on m.tenant_id = s.tenant_id and m.id = s.membership_id
         join staff_roles sr on sr.tenant_id = s.tenant_id and sr.staff_id = s.id and sr.role = 'owner'
        where s.tenant_id = $1 limit 1`,
      [tenantId],
    )
  ).rows[0];
  let row: OwnerRow;
  if (existing) {
    row = { staffId: existing.staff_id, accountId: existing.account_id };
  } else {
    const acc = (
      await env.owner.query<{ id: string }>(
        `insert into auth_user (name, email, two_factor_enabled) values ('Owner Situs', $1, true) returning id`,
        [`owner-situs-${tenantId}@iso.test`],
      )
    ).rows[0].id;
    const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Owner Situs" });
    const c = await env.owner.connect();
    try {
      await assignRole(c, { tenantId, staffId, role: "owner" });
    } finally {
      c.release();
    }
    row = { staffId, accountId: acc };
  }
  owners.set(tenantId, row);
  return row;
}

export async function asSitusOwner<R>(env: IsolationEnv, tenantId: string, fn: (db: pg.ClientBase) => Promise<R>): Promise<R> {
  const own = await ensureSitusOwner(env, tenantId);
  return withTenantContext(
    env.app,
    { tenantId, staffId: own.staffId, roles: ["owner"], allowedBranchIds: "*" },
    fn,
  );
}

export async function ensurePublishedSiteSeed(env: IsolationEnv, tenantId: string, branchId: string): Promise<Seed> {
  const existing = seeded.get(tenantId);
  if (existing) return existing;

  const own = await ensureSitusOwner(env, tenantId);
  const short = tenantId.replace(/-/g, "").slice(-10);
  const slug = `klinik-iso-${short}`;
  const brandMarker = `SITUS-BRAND-${short.toUpperCase()}`;
  const promoCode = `PRM${short.slice(0, 8).toUpperCase()}`;
  const treatmentSlug = `facial-${short}`;

  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [tenantId]);
  await env.owner.query(
    `update branches set publish_from = clock_timestamp() - interval '1 day', publish_until = null, address = $2 where id = $1`,
    [branchId, `Jl. Situs ${short}, Jakarta`],
  );
  const branchCode = (
    await env.owner.query<{ code: string }>(`select code from branches where id = $1`, [branchId])
  ).rows[0].code.toLowerCase();

  // Approve Q-15 counsel evidence
  const content = Buffer.from(`%PDF-1.4 iso counsel ${short}`);
  const sha = createHash("sha256").update(content).digest("hex");
  const itemId = (
    await env.owner.query<{ id: string }>(
      `insert into evidence_items (tenant_id, obligation_key, state, valid_until)
       values ($1, 'public_site_counsel', 'approved', '2030-12-31')
       on conflict (tenant_id, obligation_key) do update set state = 'approved', valid_until = '2030-12-31'
       returning id`,
      [tenantId],
    )
  ).rows[0].id;
  const fileId = (
    await env.owner.query<{ id: string }>(
      `insert into evidence_files (tenant_id, item_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
       values ($1, $2, 1, 'counsel.pdf', 'application/pdf', $3, $4, $5, 'Konsultan', '2026-11-20', $6, 'owner', 'Owner')
       on conflict (item_id, version) do update set sha256 = excluded.sha256
       returning id`,
      [tenantId, itemId, content.byteLength, sha, content, own.staffId],
    )
  ).rows[0].id;
  await env.owner.query(
    `insert into evidence_approvals (tenant_id, item_id, file_id, decision, valid_until, decided_by, decided_as, decided_name)
     values ($1, $2, $3, 'approved', '2030-12-31', $4, 'owner', 'Owner')`,
    [tenantId, itemId, fileId, own.staffId],
  );

  // Seed one active catalog service
  const svcId = (
    await env.owner.query<{ id: string }>(
      `insert into catalog_items (tenant_id, kind, code, created_by)
       values ($1, 'service', $2, $3)
       on conflict (tenant_id, code) do update set code = excluded.code
       returning id`,
      [tenantId, `SV-${short.slice(0, 6).toUpperCase()}`, own.staffId],
    )
  ).rows[0].id;
  await env.owner.query(
    `insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, category, treatment_min, online_bookable, contraindications, reason, created_by, created_as)
     values ($1, $2, 1, 'active', $3, 'taxable_service', 'Jasa estetika', 400000, 'facial', 45, true, 'Infeksi aktif.', 'Seed', $4, 'owner')
     on conflict (tenant_id, item_id, version) do nothing`,
    [tenantId, svcId, `Facial ${brandMarker}`, own.staffId],
  );
  await env.owner.query(
    `insert into branch_services (tenant_id, branch_id, item_id) values ($1, $2, $3) on conflict do nothing`,
    [tenantId, branchId, svcId],
  );

  await asSitusOwner(env, tenantId, async (db) => {
    await saveSiteSettings(db, {
      slug,
      brandName: brandMarker,
      oneLine: `Layanan resmi ${brandMarker}.`,
      showTreatments: true,
      showBranches: true,
      showDoctors: true,
      tariffListAllowed: false,
    });
    await savePublicWebField(db, {
      itemId: svcId,
      publicSlug: treatmentSlug,
      published: true,
      publishPrice: false,
      purpose: `Perawatan dasar kulit di ${brandMarker}.`,
      performedBy: "Terapis terlatih",
    });
    const revSrc = await getPublicWebReviewSource(db, svcId);
    await approvePublicWebReview(db, svcId, { version: revSrc.activeVersion, artifactSha256: revSrc.artifactSha256 });
    const pub = await publishPublicSite(db);
    if (!pub.ok) throw new Error(`Seed publish failed: ${pub.reason}`);
    await createPromoCode(db, `iso-promo-${short}`, promoCode, 10, {
      validFrom: "2026-01-01",
      validTo: "2030-12-31",
      discountKind: "percent",
      discountValue: 10,
      itemIds: [svcId],
    });
  });

  const s: Seed = { slug, brandMarker, promoCode, serviceItemId: svcId, treatmentSlug, branchSlug: branchCode };
  seeded.set(tenantId, s);
  return s;
}

export default defineCases(
  {
    kind: "route",
    id: "/situs",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.brandMarker ?? "",
    async run(env) {
      const v = await ensurePublishedSiteSeed(env, env.victim.tenantId, env.victim.branchId);
      env.victimSecret(v.brandMarker);
      const data = await asSitusOwner(env, env.actor.tenantId, (db) => getSiteAdminView(db));
      return { status: 200, body: data };
    },
  },
  {
    kind: "route",
    id: "/situs/promo",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.promoCode ?? "",
    async run(env) {
      const v = await ensurePublishedSiteSeed(env, env.victim.tenantId, env.victim.branchId);
      env.victimSecret(v.promoCode);
      const promos = await asSitusOwner(env, env.actor.tenantId, (db) => listPromoCodes(db));
      return { status: 200, body: promos };
    },
  },
  {
    kind: "action",
    id: "app/(app)/situs/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.serviceItemId ?? "",
    async run(env) {
      const v = await ensurePublishedSiteSeed(env, env.victim.tenantId, env.victim.branchId);
      env.victimSecret(v.brandMarker);
      try {
        const res = await asSitusOwner(env, env.actor.tenantId, (db) =>
          savePublicWebField(db, {
            itemId: v.serviceItemId,
            publicSlug: v.treatmentSlug,
            published: true,
            publishPrice: false,
            purpose: `Pembaruan perawatan ${v.brandMarker}.`,
            performedBy: "Dokter klinik",
          }),
        );
        return { attempts: { saveVictimService: "done" }, body: res };
      } catch (e) {
        const code = ((e as { message?: string }).message ?? "").split(":")[0] || "ERR_REFUSED";
        return { attempts: { saveVictimService: code }, body: null };
      }
    },
  },
  {
    kind: "action",
    id: "app/(app)/situs/promo/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.promoCode ?? "",
    async run(env) {
      const v = await ensurePublishedSiteSeed(env, env.victim.tenantId, env.victim.branchId);
      env.victimSecret(v.promoCode);
      const promos = await asSitusOwner(env, env.actor.tenantId, (db) => listPromoCodes(db));
      const found = promos.find((p) => p.code === v.promoCode);
      return {
        attempts: { readVictimPromo: found ? "done" : "ERR_NOT_FOUND" },
        body: found ? { code: found.code, id: found.id } : null,
      };
    },
  },
);
