// T-018 Done-when: scenario PR-55 passes; placeholder values render marked and block
// production go-live.
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import {
  assertProductionGoLive,
  deployEnv,
  GoLiveBlockedError,
  goLiveBlockers,
  PLACEHOLDER_LABEL,
  renderField,
  setResidencyOpinion,
  updateProfile,
  type VendorActor,
  vendorIdentity,
  VendorProfileError,
} from "../../src/modules/vendor/profile/profile";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let opPool: pg.Pool;
let op: pg.PoolClient; // platform operator connection (database owner)
let owner: VendorActor;
let support: VendorActor;

const REAL = {
  legal_name: "PT Sintetis Teknologi Klinik",
  nib: "1234567890123",
  pse_number: "000123.01/DJAI.PSE/11/2026",
  npwp: "0123456789012345",
  meta_business_id: "123456789012345",
  website: "https://vendor-sintetis.example",
  privacy_url: "https://vendor-sintetis.example/privasi",
  support_email: "dukungan@vendor-sintetis.example",
  support_phone: "+6281234567890",
};
const SINGAPORE = (["database", "object_storage", "backups", "logs", "error_tracking"] as const).map((kind) => ({
  kind, provider: "Vultr", region: "Singapore", country: "SG",
}));
const opinionFile = (tag: string) => Buffer.from(`Pendapat hukum sintetis ${tag}\n`.repeat(64));
const INDONESIA = SINGAPORE.map((l) => ({ ...l, provider: "Penyedia Lokal", region: "Jakarta", country: "ID" }));

async function account(name: string) {
  return (await h.admin.query(`insert into auth_user (name, email) values ($1, $2) returning id`, [name, `${name}.${Date.now()}@vendor-sintetis.test`])).rows[0].id as string;
}

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 2 });
  opPool = new pg.Pool({ connectionString: h.ownerUrl(), max: 1 });
  op = await opPool.connect();
  owner = { accountId: await account("owner"), vendorRole: "platform_owner" };
  support = { accountId: await account("support"), vendorRole: "support" };
});

afterAll(async () => {
  op?.release();
  await opPool?.end();
  await app?.end();
  await h?.close();
});

// Each test starts from the migration's placeholder profile (S-04).
beforeEach(async () => {
  await h.admin.query(
    `update vendor_profile set legal_name = 'PT [Nama Badan Usaha]', nib = '[NIB]', pse_number = '[Nomor PSE]', npwp = '[NPWP]',
       meta_business_id = '[Meta Business ID]', website = 'https://[situs-vendor]', privacy_url = 'https://[situs-vendor]/kebijakan-privasi',
       support_email = 'dukungan@[situs-vendor]', support_phone = '[Nomor Dukungan]',
       placeholder_fields = array['legal_name','nib','pse_number','npwp','meta_business_id','website','privacy_url','support_email','support_phone'],
       storage_locations = '[]', residency_opinion_ref = null, residency_opinion_date = null, residency_opinion_outcome = null,
       residency_opinion_set_by = null, residency_opinion_checksum = null where id = 1`,
  );
});

const asApp = async <T>(fn: (c: pg.PoolClient) => Promise<T>) => {
  const c = await app.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
};

describe("scenario PR-55 placeholder vendor profile", () => {
  it('"PT [Nama Badan Usaha]" renders marked as placeholder on a receipt or privacy page', async () => {
    const id = await asApp(vendorIdentity);
    expect(id.legal_name).toBe("PT [Nama Badan Usaha]");
    expect(renderField(id, "legal_name")).toEqual({
      text: "PT [Nama Badan Usaha]",
      placeholder: true,
      label: `PT [Nama Badan Usaha] (${PLACEHOLDER_LABEL})`,
    });
    expect(renderField(id, "privacy_url").placeholder).toBe(true);
  });

  it("production go-live is blocked until the placeholder is replaced; staging/demo/local are not", async () => {
    expect(await goLiveBlockers(op)).toContain("placeholder:legal_name");
    await asApp(async (c) => {
      const err = await assertProductionGoLive(c, "production").catch((e) => e);
      expect(err).toBeInstanceOf(GoLiveBlockedError);
      expect(err.message).not.toMatch(/placeholder|residency|storage/); // reasons stay with the operator
      for (const env of ["staging", "demo", "local"] as const) await expect(assertProductionGoLive(c, env)).resolves.toBeUndefined();
    });
  });

  it("the environment fails closed: unset or unknown DEPLOY_ENV is production", () => {
    expect(deployEnv({})).toBe("production");
    expect(deployEnv({ DEPLOY_ENV: "Staging" })).toBe("production");
    expect(deployEnv({ DEPLOY_ENV: "prod" })).toBe("production");
    expect(deployEnv({ DEPLOY_ENV: "staging" })).toBe("staging");
  });

  it("replacing every placeholder and declaring Indonesian storage unblocks go-live", async () => {
    await updateProfile(op, owner, { ...REAL, storageLocations: INDONESIA }, "Badan usaha vendor sudah terdaftar");
    await asApp(async (c) => {
      const id = await vendorIdentity(c);
      expect(id.placeholders).toEqual([]);
      expect(renderField(id, "legal_name")).toEqual({ text: REAL.legal_name, placeholder: false, label: REAL.legal_name });
      await expect(assertProductionGoLive(c, "production")).resolves.toBeUndefined();
    });
  });

  it("one placeholder left keeps go-live blocked and marked", async () => {
    const rest = Object.fromEntries(Object.entries(REAL).filter(([k]) => k !== "npwp"));
    await updateProfile(op, owner, { ...rest, storageLocations: INDONESIA }, "Sebagian data vendor");
    expect(await goLiveBlockers(op)).toEqual(["placeholder:npwp"]);
    await asApp(async (c) => expect(renderField(await vendorIdentity(c), "npwp").placeholder).toBe(true));
  });

  it("detection fails closed for writes that bypass the module: any bracket or blank value", async () => {
    await updateProfile(op, owner, { ...REAL, storageLocations: INDONESIA }, "Data lengkap");
    for (const v of ["PT [Belum Ada]", "PT [Nama", "PT Nama]"]) {
      await h.admin.query(`update vendor_profile set legal_name = $1 where id = 1`, [v]);
      expect(await goLiveBlockers(op), v).toEqual(["placeholder:legal_name"]);
    }
    await expect(h.admin.query(`update vendor_profile set nib = '  ' where id = 1`)).rejects.toMatchObject({ code: "23514" });
    await expect(h.admin.query(`update vendor_profile set nib = '' where id = 1`)).rejects.toMatchObject({ code: "23514" });
  });
});

describe("storage locations and the residency opinion (PR-36, H-02d)", () => {
  it("undeclared storage kinds block go-live", async () => {
    await updateProfile(op, owner, { ...REAL, storageLocations: INDONESIA.slice(0, 3) }, "Lokasi sebagian");
    expect(await goLiveBlockers(op)).toEqual(["storage_undeclared:logs", "storage_undeclared:error_tracking"]);
  });

  it("Singapore storage blocks go-live until a positive opinion; a negative opinion keeps it blocked", async () => {
    await updateProfile(op, owner, { ...REAL, storageLocations: SINGAPORE }, "Produksi di Vultr Singapura (H-02b)");
    expect(await goLiveBlockers(op)).toEqual(["residency_opinion_required"]);
    await setResidencyOpinion(op, owner, { ref: "PH/2026/011", date: "2026-11-01", outcome: "negative", file: opinionFile("A") }, "Pendapat hukum diterima");
    expect(await goLiveBlockers(op)).toEqual(["residency_opinion_negative"]);
    await asApp(async (c) => expect(assertProductionGoLive(c, "production")).rejects.toBeInstanceOf(GoLiveBlockedError));
    await setResidencyOpinion(op, owner, { ref: "PH/2026/012", date: "2026-11-02", outcome: "positive", file: opinionFile("B") }, "Pendapat hukum kedua");
    expect(await goLiveBlockers(op)).toEqual([]);
    await asApp(async (c) => expect(assertProductionGoLive(c, "production")).resolves.toBeUndefined());
    const { rows } = await h.admin.query(`select residency_opinion_set_by, residency_opinion_checksum from vendor_profile`);
    expect(rows[0].residency_opinion_set_by).toBe(owner.accountId);
    expect(rows[0].residency_opinion_checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("only the platform owner sets the opinion or edits the profile; every change is audited", async () => {
    await expect(
      setResidencyOpinion(op, support, { ref: "PH/2026/013", date: "2026-11-02", outcome: "positive", file: opinionFile("C") }, "Coba"),
    ).rejects.toBeInstanceOf(VendorProfileError);
    await expect(updateProfile(op, support, { nib: REAL.nib }, "Coba")).rejects.toBeInstanceOf(VendorProfileError);
    const before = (await h.admin.query(`select count(*)::int as n from vendor_profile_changes`)).rows[0].n;
    await updateProfile(op, owner, { nib: REAL.nib, npwp: REAL.npwp }, "NIB dan NPWP terbit");
    const { rows } = await h.admin.query(
      `select field, actor_account_id, actor_role, old_value, new_value, reason from vendor_profile_changes order by at desc, field limit 2`,
    );
    expect((await h.admin.query(`select count(*)::int as n from vendor_profile_changes`)).rows[0].n).toBe(before + 2);
    expect(rows.map((r) => [r.field, r.actor_role, r.old_value, r.new_value])).toEqual(
      expect.arrayContaining([
        ["nib", "platform_owner", "[NIB]", REAL.nib],
        ["npwp", "platform_owner", "[NPWP]", REAL.npwp],
      ]),
    );
    await expect(h.admin.query(`update vendor_profile_changes set reason = 'diubah'`)).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`delete from vendor_profile_changes`)).rejects.toMatchObject({ code: "42501" });
  });

  it("invalid values are refused, including a new bracketed placeholder", async () => {
    for (const bad of [
      { nib: "12" }, { npwp: "abc" }, { legal_name: "Nama [Sementara]" }, { legal_name: "PT [Nama" }, { legal_name: "PT ]" },
      { legal_name: "PT Sintetis\u200b" }, { website: "http://insecure.example" }, { support_phone: "0812" },
      { nib: undefined as unknown as string },
    ]) {
      await expect(updateProfile(op, owner, bad, "Uji"), JSON.stringify(bad)).rejects.toBeInstanceOf(VendorProfileError);
    }
    await expect(updateProfile(op, owner, { nib: REAL.nib }, "")).rejects.toBeInstanceOf(VendorProfileError);
    for (const date of ["2026-02-31", "2099-01-01", "2026-1-1"]) {
      await expect(
        setResidencyOpinion(op, owner, { ref: "PH/2026/020", date, outcome: "positive", file: opinionFile("D") }, "Uji"),
        date,
      ).rejects.toBeInstanceOf(VendorProfileError);
    }
    await expect(
      setResidencyOpinion(op, owner, { ref: "PH/2026/021", date: "2026-11-01", outcome: "positive", file: Buffer.from("x") }, "Uji"),
    ).rejects.toBeInstanceOf(VendorProfileError);
    await expect(
      updateProfile(op, owner, { storageLocations: [{ kind: "database", provider: "Vultr", region: "Singapore", country: "Singapore" }] }, "Uji"),
    ).rejects.toBeInstanceOf(VendorProfileError);
  });
});

describe("transactions", () => {
  it("operator writes refuse to run inside the caller's open transaction (no early commit)", async () => {
    await op.query("begin");
    try {
      await expect(updateProfile(op, owner, { nib: REAL.nib }, "Uji")).rejects.toBeInstanceOf(VendorProfileError);
    } finally {
      await op.query("rollback");
    }
    expect((await h.admin.query(`select nib from vendor_profile`)).rows[0].nib).toBe("[NIB]");
  });
});

describe("isolation (TEN-16)", () => {
  it("the clinic app cannot read or write the vendor profile or its change log", async () => {
    await asApp(async (c) => {
      for (const sql of [
        `select * from vendor_profile`,
        `select * from vendor_profile_changes`,
        `update vendor_profile set legal_name = 'PT Palsu'`,
        `select vendor_placeholder_fields()`,
        // The residency posture and legal outcome stay with the operator.
        `select vendor_go_live_blockers()`,
      ]) {
        await expect(c.query(sql), sql).rejects.toMatchObject({ code: "42501" });
      }
    });
  });

  it("the public identity carries no residency or tax evidence", async () => {
    await setResidencyOpinion(op, owner, { ref: "PH/2026/014", date: "2026-11-02", outcome: "positive", file: opinionFile("E") }, "Uji");
    const id = await asApp(vendorIdentity);
    expect(Object.keys(id).sort()).toEqual([
      "legal_name", "meta_business_id", "nib", "npwp", "placeholders", "privacy_url", "pse_number", "support_email", "support_phone", "website",
    ]);
  });
});
