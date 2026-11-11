// T-017 Done-when: scenarios PR-38 (out of bounds, restore default) pass; every SET row in
// 19 §5 exists with its default, bound and changer; fixed rules are absent from the
// registry; SET-44 accepts month_end or day(1..28), defaults to month_end and never
// changes the monthly cadence. Plus drafts through Persetujuan, branch scope, the
// snapshot helper, append-only history and tenant isolation.
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { inboxDetail, listInbox } from "../../src/modules/approvals/inbox";
import { CommandError } from "../../src/lib/command";
import { cancelApproval, decideApproval, requestApproval } from "../../src/modules/approvals/approvals";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { GROUPS, SETTING_BY_KEY, SETTINGS } from "../../src/modules/settings/registry";
import { cancelDraft, changeSetting, decideDraft, groupRows, SettingBoundsError, settingValue } from "../../src/modules/settings/settings";
import { accentWorstRatio, boundsText, fromForm, parseWhole, type Spec, validate, type Value } from "../../src/modules/settings/spec";
import { createHarness, type Harness, testPool } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string; name: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("B1"), b2: await br("B2") };
}

async function person(t: T, roles: Role[], branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`set${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const name = `Staf Set ${n}`;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: name });
  for (const role of roles) {
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (branch && !TENANT_WIDE.includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: branch });
  }
  return { acc, staffId, tenantId: t.tenantId, role: roles[0], branch, name };
}

const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: TENANT_WIDE.includes(p.role) ? undefined : p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : e instanceof SettingBoundsError ? `bounds:${e.message}` : `raw:${e.code ?? e.message}`));
const set = (p: P, key: string, value: Value, branchId: string | null = null, reason = "Uji perubahan") => as(p, (db) => changeSetting(db, { key, branchId, value, reason }));

// Tests share tenant A and run in file order (values carry forward between tests); the
// version-state assertions use settings no earlier test touches.
let A: T;
let B: T;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-38", () => {
  it("package validity 1500 days is rejected naming the bound; the old value stays active", async () => {
    const own = await person(A, ["owner"]);
    expect(await code(set(own, "SET-8", 1500))).toBe("bounds:Masa berlaku paket default harus 30–1095 hari.");
    expect(await as(own, (db) => settingValue(db, "SET-8"))).toBe(365);
    // The database refuses it too, past the server check.
    expect(await code(as(own, (db) => db.query(`select setting_set('SET-8', null, '1500'::jsonb, now(), 'lewat batas', false)`)))).toBe("raw:P0422");
    await set(own, "SET-8", 730);
    expect(await as(own, (db) => settingValue(db, "SET-8"))).toBe(730);
  });

  it("restore default: reminder time changed to 08:00, Admin Pusat taps Kembalikan ke default → H-1 10:00 with a new audited version", async () => {
    const ap = await person(A, ["admin_pusat"]);
    await set(ap, "SET-18", { h1: "08:00", sebelum: 3 }, A.b1);
    expect(await as(ap, (db) => settingValue(db, "SET-18", A.b1))).toEqual({ h1: "08:00", sebelum: 3 });
    const r = await as(ap, (db) => changeSetting(db, { key: "SET-18", branchId: A.b1, restore: true, reason: "Kembali ke jam riset" }));
    expect(r.state).toBe("active");
    expect(await as(ap, (db) => settingValue(db, "SET-18", A.b1))).toEqual({ h1: "10:00", sebelum: 2 });
    const rows = await as(ap, (db) => groupRows(db, "admin_pusat", "komunikasi", A.b1));
    const row = rows.find((x) => x.def.key === "SET-18")!;
    expect(row.isDefault).toBe(true);
    // Object defaults compare by content, not key order (jsonb reorders keys).
    const own = await person(A, ["owner"]);
    const money = await as(own, (db) => groupRows(db, "owner", "uang", null));
    expect(money.filter((x) => x.def.kind === "value" && x.history.length === 0).every((x) => x.isDefault)).toBe(true);
    expect(row.history.map((v) => [v.restoredDefault, v.changedName, v.changedAs])).toEqual([[true, ap.name, "admin_pusat"], [false, ap.name, "admin_pusat"]]);
    const audit = (await h.admin.query(`select reason_code from audit_events where object_id = $1`, [row.history[0].id])).rows;
    expect(audit).toEqual([{ reason_code: "setting_restored" }]);
    // The database writes the registry default on restore, whatever value is passed.
    await set(ap, "SET-17", 25);
    await as(ap, (db) => db.query(`select setting_set('SET-17', null, '29'::jsonb, now(), 'kembali default', true)`));
    expect(await as(ap, (db) => settingValue(db, "SET-17"))).toBe(10);
  });

  it("a setting outside the decided list does not exist; fixed rules cannot be changed", async () => {
    const own = await person(A, ["owner"]);
    for (const key of ["SET-99", "idle_lock", "ppn_rate", "SET-50"]) {
      expect(await code(set(own, key, 1)), key).toBe("ERR_SETTING_NOT_ALLOWED");
      expect(await code(as(own, (db) => db.query(`select setting_set($1, null, '1'::jsonb, now(), 'tidak ada', false)`, [key])))).toBe("raw:P0422");
    }
    // A ref row (structured data owned by its page) is not edited through the registry.
    expect(await code(set(own, "SET-5", 1000))).toBe("ERR_SETTING_NOT_ALLOWED");
  });
});

describe("registry (19 §5)", () => {
  it("every SET-1–SET-49 row exists with its default, bounds and changers; the database equals the registry", async () => {
    const keys = new Set(SETTINGS.map((s) => s.key.split(".")[0]));
    expect([...Array(49)].map((_, i) => `SET-${i + 1}`).filter((k) => !keys.has(k))).toEqual([]);
    const spec19 = readFileSync("docs/spec/19-NAVIGATION-PAGE-CATALOGUE.md", "utf8");
    const rows19 = [...spec19.matchAll(/^\| (SET-\d+) \| ([^|]+) \|/gm)].map((m) => [m[1], m[2].trim()]);
    expect(rows19).toHaveLength(49);
    for (const [key, group] of rows19) {
      const def = SETTINGS.find((s) => s.key === key)!;
      expect(GROUPS.find((g) => g.slug === def.group)!.label, key).toBe(group);
    }
    for (const s of SETTINGS) {
      expect(s.changers.length + s.drafts.length, s.key).toBeGreaterThan(0);
      if (s.kind === "value") expect(validate(s.spec, s.default), s.key).toBeNull();
    }
    const { rows } = await h.admin.query(`select key, group_slug, label, kind, scope, spec, default_value, changers, drafts from setting_defs order by key`);
    expect(rows).toEqual(
      SETTINGS.map((s) => ({
        key: s.key, group_slug: s.group, label: s.label, kind: s.kind, scope: s.scope,
        spec: s.kind === "value" ? s.spec : null, default_value: s.kind === "value" ? s.default : null, changers: s.changers, drafts: s.drafts,
      })).sort((a, b) => (a.key < b.key ? -1 : 1)),
    );
  });

  it("changers follow 19 §5 'Changed by' (plus the owner, 07 ●) — checked against the spec text", () => {
    const spec19 = readFileSync("docs/spec/19-NAVIGATION-PAGE-CATALOGUE.md", "utf8");
    const changedBy = Object.fromEntries([...spec19.matchAll(/^\| (SET-\d+) \|(?:[^|]*\|){5}([^|]+)\|/gm)].map((m) => [m[1], m[2].trim()]));
    // How each 19 §5 phrase maps to roles (direct changers, drafters).
    const ROLE_WORDS: [RegExp, Role][] = [
      [/Owner/i, "owner"], [/Admin Pusat/i, "admin_pusat"], [/[Mm]anager/, "manager"], [/[Ff]acility head/, "facility_head"],
      [/[Pp]harmacist/, "pharmacist"], [/[Pp]urchasing/, "purchasing"], [/[Mm]arketing/, "marketing"],
    ];
    for (const [key, phrase] of Object.entries(changedBy)) {
      const named = ROLE_WORDS.filter(([re]) => re.test(phrase)).map(([, r]) => r);
      for (const sub of SETTINGS.filter((x) => x.key === key || x.key.startsWith(`${key}.`))) {
        const can = new Set([...sub.changers, ...sub.drafts.map((d) => d.by), ...sub.drafts.map((d) => d.approver)]);
        for (const r of named) {
          // SET-31's two parts: klinis = facility head, layanan = owner (DEC-026).
          if (key === "SET-31" && ((sub.key === "SET-31" && r === "owner") || (sub.key === "SET-31.layanan" && r === "facility_head"))) continue;
          expect(can.has(r), `${sub.key}: ${r} from "${phrase}"`).toBe(true);
        }
        // Nobody outside 19 §5 and the owner (07 ●) changes or drafts it, except Admin
        // Pusat drafting money rows (07 ◐ "money … as drafts for Owner").
        for (const r of sub.changers) expect([...named, "owner"].includes(r), `${sub.key}: unexpected changer ${r}`).toBe(true);
        // 07 ◐: Admin Pusat drafts money rows (Uang & Kasir, and the commission money rows
        // SET-25/SET-44) for the owner; other drafters are named by 19 §5.
        const ADMIN_PUSAT_MONEY = sub.group === "uang" || sub.key === "SET-25" || sub.key === "SET-44";
        for (const d of sub.drafts) expect(named.includes(d.by) || (d.by === "admin_pusat" && ADMIN_PUSAT_MONEY), `${sub.key}: unexpected drafter ${d.by}`).toBe(true);
        // A role 19 §5 names changes the row directly unless the row is a proposal-only rule.
        if (sub.key !== "SET-48") for (const r of named) if (!(key === "SET-31" && ((sub.key === "SET-31" && r === "owner") || (sub.key === "SET-31.layanan" && r === "facility_head")))) expect(sub.changers.includes(r), `${sub.key}: ${r} changes directly`).toBe(true);
      }
    }
    expect(Object.keys(changedBy)).toHaveLength(49);
    // The owner (07 ●) changes every row except SET-48 (pharmacist proposes, facility head
    // approves). SET-30 names the owner itself (with the facility head, two people).
    expect(SETTINGS.filter((x) => !x.changers.includes("owner")).map((x) => x.key).sort()).toEqual(["SET-48"]);
  });

  it("defaults and bounds equal a golden table reviewed against 19 §5", () => {
    // [key, default, bounds text] — reviewed by hand against 19 §5 (Default, Bounds).
    const GOLDEN: [string, Value, string][] = [
      ["SET-4", { persiapan: 10, tindakan: 30, jeda: 10 }, "Persiapan: 0–120 menit; Tindakan: 5–480 menit; Jeda: 0–120 menit"],
      ["SET-7", { jumlah: 1, hari: 7 }, "Jumlah kontrol: 0–5 kali; Berlaku sampai tanggal kontrol +: 0–30 hari"],
      ["SET-8", 365, "30–1095 hari"],
      ["SET-10", { dp_booking: false, batas_ubah: 24 }, "DP booking: Aktif / Nonaktif; Batas ubah jadwal: 0–72 jam"],
      ["SET-11", "owner", "Owner / Owner + Manajer"],
      ["SET-12", { fo_persen: 0, manajer_persen: 10, manajer_rupiah: 500_000 }, "FO/Kasir: 0–100 %; Manajer (persen): 0–100 %; Manajer (rupiah): minimal Rp0"],
      ["SET-13", 50_000, "Rp0–Rp1.000.000"],
      ["SET-15", null, "Nonaktif, atau 5–60 menit"],
      ["SET-16", { horizon: 30, batas: 2, dp_pasien_baru: false }, "Horizon: 1–90 hari; Batas sebelum jadwal: 0–48 jam; DP wajib pasien baru: Aktif / Nonaktif"],
      ["SET-17", 10, "5–30 menit"],
      ["SET-18", { h1: "10:00", sebelum: 2 }, "H-1 pukul: 07:00–21:00; Hari H, sebelum jadwal: 1–12 jam"],
      ["SET-20", 15, "5–120 menit"],
      ["SET-21", 80, "10–90 % batas Meta"],
      ["SET-22", { kunjungan_kedua: 60, tidak_datang: 90 }, "Kunjungan kedua: 14–365 hari; Tidak datang: 14–365 hari"],
      ["SET-23", [30, 14, 7], "1–3 nilai, masing-masing 1–90 hari, menurun"],
      ["SET-27", { nilai_tinggi: "mingguan", lainnya: "bulanan", kedaluwarsa: 30 }, "Hitung item nilai tinggi: Harian / Mingguan / Bulanan; Hitung item lain: Harian / Mingguan / Bulanan; Peringatan hampir kedaluwarsa: 7–180 hari"],
      ["SET-29", ["depan", "serong_45", "samping"], "1–6 nilai, masing-masing Depan / Serong 45° / Samping / Atas / Bawah (dagu) / Close-up area"],
      ["SET-31", { merah: 15, kuning: 120, hijau: 8 }, "Merah: 5–60 menit; Kuning: 30–240 menit; Hijau: 4–24 jam kerja"],
      ["SET-31.layanan", 8, "1–24 jam kerja"],
      ["SET-35", { batas_sesi: 15, tanda_tangan: "pin" }, "Batas waktu sesi: 5–60 menit; Tanda tangan klinis: PIN / OTP"],
      ["SET-38", 20, "5–120 menit"],
      ["SET-44", { k: "month_end" }, "Akhir bulan atau Tanggal (1–28)"],
      ["SET-47", 90, "30–365 hari"],
      ["SET-48", { masa: 30, masa_akut: 7, jeda: 75, sebagian: 4 }, "Masa berlaku: 3–90 hari; Masa berlaku resep akut: 3–90 hari; Jeda isi ulang: 50–95 % perkiraan hari pakai; Penyerahan sebagian: 1–4 kali"],
      ["SET-49", 90, "0–90 hari"],
      ["SET-1", { nama: null, aksen: "#0A6E86" }, "Nama tampil: Nama PT, atau 2–60 karakter; Warna aksen: warna hex dengan kontras ≥ 4,5:1 (UI-2)"],
      ["SET-6", null, "Belum diisi, atau minimal Rp1"],
      ["SET-9", { dp_minimum: null, cicilan: true }, "DP minimum: Kosong, atau 0–100 %; Cicilan: Diizinkan / Tidak diizinkan"],
      ["SET-14", { metode: ["tunai", "qris", "edc", "transfer", "saldo"], provider: "mock", link_jam: 24 }, "Metode bayar: 1–5 nilai, masing-masing Tunai / QRIS / EDC / Transfer / Saldo; Provider: Mock (belum ada mitra); Masa berlaku link bayar: 1–72 jam"],
      ["SET-19", { aftercare: 1, kepuasan: 7, rencana: 14, belum_jadwal: 21, pengingat: 3, isi_ulang: 5, ulang_tahun: false, batas_harian: 2 }, "Aftercare (H+): Nonaktif, atau 0–60 hari; Tindak lanjut kepuasan (H+): Nonaktif, atau 0–60 hari; Tindak lanjut rencana (H+): Nonaktif, atau 0–60 hari; Belum ada jadwal (H+): Nonaktif, atau 0–60 hari; Pengingat janji (H-): Nonaktif, atau 0–60 hari; Isi ulang produk (H- perkiraan habis): Nonaktif, atau 0–60 hari; Ucapan ulang tahun: Aktif / Nonaktif; Batas pesan per pasien: 1–5 pesan/hari"],
      ["SET-25", { metrik: "closing_rencana", periode: "bulanan" }, "Metrik: Nilai closing/bulan + rencana terpilih penuh; Periode: Bulanan / Triwulan"],
      ["SET-37", { ringkasan: null, penerima: ["owner"] }, "Ringkasan harian pukul: Nonaktif, atau 17:00–23:00; Penerima laporan terjadwal: 1–4 nilai, masing-masing Owner / Admin Pusat / Keuangan / Manajer"],
      ["SET-40", { prefiks_loket: "A", prefiks_ruang: "B", suara: false, orientasi: "landscape" }, "Prefiks loket: 1–3 huruf kapital; Prefiks ruang: 1–3 huruf kapital; Panggilan suara: Aktif / Nonaktif; Orientasi TV: Mendatar / Tegak"],
      ["SET-41", { cicilan_maks: null, mundur: 1 }, "Cicilan maksimum: Tanpa batas, atau 2–24 kali; Tanggal mundur (dengan persetujuan): 0–3 hari"],
      ["SET-42", "manual", "Manual / Bergilir per cabang"],
      ["SET-43", { void: "manajer_hari_sama", selisih_opname: 2, po_owner: 10_000_000, musnah_kedua_kejadian: 1_000_000, musnah_kedua_bulan: 5_000_000, musnah_owner: 10_000_000 }, "Penyetuju void: Manajer di hari yang sama, setelahnya owner / Selalu owner; Ambang selisih opname: 0–100 %; PO perlu owner mulai: minimal Rp0; Pemusnahan: persetujuan kedua mulai (per kejadian): minimal Rp0; Pemusnahan: persetujuan kedua mulai (per bulan): minimal Rp0; Pemusnahan: owner mulai: minimal Rp0"],
    ];
    // Every value row is in the golden table (a new row cannot slip in unreviewed).
    expect(GOLDEN.map(([k]) => k).sort()).toEqual(SETTINGS.filter((x) => x.kind === "value").map((x) => x.key).sort());
    for (const [key, def, bounds] of GOLDEN) {
      const sdef = SETTING_BY_KEY.get(key)!;
      expect(sdef?.kind, key).toBe("value");
      if (sdef.kind !== "value") continue;
      expect(sdef.default, key).toEqual(def);
      expect(boundsText(sdef.spec), key).toBe(bounds);
    }
    // Money floors that are fixed rules: the consultation fee is > 0 when set.
    expect(validate((SETTING_BY_KEY.get("SET-6") as { spec: Spec }).spec, 0)?.message).toMatch(/minimal Rp1/);
  });

  it("every role × row: the editor shows exactly the rows a role changes or drafts, and the database agrees", async () => {
    const ALL: Role[] = ["owner", "admin_pusat", "manager", "facility_head", "records_officer", "fo_cashier", "central_cs", "bc", "doctor", "nurse", "therapist", "pharmacist", "finance", "marketing", "purchasing", "auditor"];
    const people = new Map<Role, P>();
    for (const r of ALL) people.set(r, await person(A, [r], TENANT_WIDE.includes(r) ? undefined : A.b1));
    for (const r of ALL) {
      const p = people.get(r)!;
      for (const g of GROUPS) {
        const shown = (await as(p, (db) => groupRows(db, r, g.slug, TENANT_WIDE.includes(r) ? null : A.b1))).map((x) => x.def.key).sort();
        const expected = SETTINGS.filter((x) => x.group === g.slug && (x.changers.includes(r) || x.drafts.some((d) => d.by === r))).map((x) => x.key).sort();
        expect(shown, `${r} ${g.slug}`).toEqual(expected);
      }
      // One tenant row and one branch row per role outside its rights are refused by the database.
      for (const scope of ["tenant", "branch"] as const) {
      const forbidden = SETTINGS.find((x) => x.kind === "value" && x.scope === scope && !x.changers.includes(r) && !x.drafts.some((d) => d.by === r));
      if (forbidden && forbidden.kind === "value") {
        const branch = forbidden.scope === "branch" ? A.b1 : null;
        expect(await code(as(p, (db) => db.query(`select setting_set($1, $2, $3::jsonb, null, 'tidak berhak', false)`, [forbidden.key, branch, JSON.stringify(forbidden.default)]))), `${r} ${forbidden.key}`).toBe("raw:42501");
      }
      }
    }
  });

  it("fixed rules (class F) are not in the registry", () => {
    const text = JSON.stringify(SETTINGS).toLowerCase();
    for (const fixed of ["idle", "120 detik", "ppn", "retensi", "nama pasien di tv", "saldo kedaluwarsa"]) {
      expect(SETTINGS.some((s) => s.kind === "value" && s.label.toLowerCase().includes(fixed)), fixed).toBe(false);
    }
    // The fixed parts are notes, never values: no key or field names a fixed rule.
    for (const fixed of ["idle", "ppn", "retensi", "retention", "sequence", "nomor_urut", "tv_nama", "saldo_kedaluwarsa", "requester"]) expect(text, fixed).not.toContain(`"${fixed}`);
    // Ref rows carry no editable value.
    for (const s of SETTINGS.filter((x) => x.kind === "ref")) expect("spec" in s || "default" in s, s.key).toBe(false);
  });

  it("the server validator and the database validator agree on every default and on boundary values", async () => {
    const cases: [Spec, Value][] = [];
    for (const s of SETTINGS) if (s.kind === "value") cases.push([s.spec, s.default]);
    const extra: [string, Value][] = [
      ["SET-8", 30], ["SET-8", 1095], ["SET-8", 29], ["SET-8", 1096], ["SET-8", 365.5], ["SET-8", "365"],
      ["SET-13", 1_000_000], ["SET-13", 1_000_001], ["SET-15", null], ["SET-15", 4], ["SET-15", 60],
      ["SET-18", { h1: "06:59", sebelum: 2 }], ["SET-18", { h1: "21:00", sebelum: 2 }], ["SET-18", { h1: "10:00" }],
      ["SET-22", { kunjungan_kedua: 90, tidak_datang: 90 }], ["SET-22", { kunjungan_kedua: 60, tidak_datang: 90 }],
      ["SET-23", [30, 14, 7]], ["SET-23", [14, 30]], ["SET-23", [30, 30]], ["SET-23", []], ["SET-23", [90, 60, 30, 7]],
      ["SET-29", ["depan", "depan"]], ["SET-29", ["depan", "atas"]], ["SET-29", ["miring"]],
      ["SET-40", { prefiks_loket: "AB", prefiks_ruang: "b", suara: true, orientasi: "portrait" }],
      ["SET-44", { k: "month_end" }], ["SET-44", { k: "day", v: 28 }], ["SET-44", { k: "day", v: 29 }], ["SET-44", { k: "day" }],
      ["SET-44", { k: "weekly" }], ["SET-44", { k: "month_end", v: 3 }],
      ["SET-1", { nama: null, aksen: "#0A6E86" }], ["SET-1", { nama: "Aurelia", aksen: "#7FD4E8" }], ["SET-1", { nama: "A", aksen: "#0A6E86" }],
      ["SET-12", { fo_persen: 0, manajer_persen: 10, manajer_rupiah: -1 }],
      ["SET-37", { ringkasan: "16:59", penerima: ["owner"] }], ["SET-37", { ringkasan: "20:00", penerima: ["owner", "finance"] }],
    ];
    for (const [k, v] of extra) cases.push([(SETTING_BY_KEY.get(k) as { spec: Spec }).spec, v]);
    for (const [spec, v] of cases) {
      const db = (await h.admin.query(`select setting_value_ok($1::jsonb, $2::jsonb) as ok`, [JSON.stringify(spec), JSON.stringify(v)])).rows[0].ok;
      expect(db, JSON.stringify([spec.t, v])).toBe(validate(spec, v) === null);
    }
    // UI-2 accent in both: the default passes, a light tint fails with its ratio named.
    expect(accentWorstRatio("#0A6E86")).toBeCloseTo((await h.admin.query(`select setting_accent_ratio('#0A6E86') as r`)).rows[0].r, 6);
    expect(validate({ t: "accent" }, "#7FD4E8")?.message).toMatch(/kontrasnya 1,\d\d:1, perlu ≥ 4,5:1/);
    expect(boundsText({ t: "int", min: 30, max: 1095, unit: "hari" })).toBe("30–1095 hari");
  });

  it("validators agree on generated boundary values of every value row (min, max, ±1, wrong type, null, missing and extra keys)", async () => {
    const gen = (sp: Spec): Value[] => {
      switch (sp.t) {
        case "int": return [sp.min, sp.max, sp.min - 1, sp.max + 1, sp.min + 0.5, String(sp.min), null, true];
        case "rupiah": return [sp.min, sp.min - 1, ...(sp.max !== undefined ? [sp.max, sp.max + 1] : [2 ** 53]), 1.5, "1000", null];
        case "bool": return [true, false, "1", 0, null];
        case "enum": return [sp.of[0].v, sp.of[sp.of.length - 1].v, "tidak_ada", sp.of[0].v.toUpperCase(), 1, null];
        case "time": return [sp.min, sp.max, "00:00", "23:59", "7:00", "24:00", "10:60", null];
        case "text": return ["A", "AB", "ABC", "ABCD", "ab", " A", "A\n", "\u00A0AB", "AB\u2028", "A\uFEFF", "A\u3000B", "Aurelia", "x".repeat(61), "😀😀", null];
        case "accent": return ["#0A6E86", "#0a6e86", "#7FD4E8", "#000000", "#FFFFFF", "0A6E86", "#0A6E8", null];
        case "obj": {
          const base = Object.fromEntries(sp.f.map((f) => [f.k, gen(f.s)[0]]));
          const out: Value[] = [base, { ...base, extra: 1 }, Object.fromEntries(Object.entries(base).slice(1)), null, []];
          for (const f of sp.f) for (const v of gen(f.s).slice(1)) out.push({ ...base, [f.k]: v });
          return out;
        }
        case "list": { const one = gen(sp.of)[0]; return [[one], [], Array(sp.max + 1).fill(one), [one, one], null, one]; }
        case "opt": return [null, ...gen(sp.of)];
        case "oneof": return [...sp.of.map((o): Value => (o.s ? { k: o.k, v: gen(o.s)[0] } : { k: o.k })), { k: "x" }, { k: sp.of[0].k, v: 1, w: 2 }, null];
      }
    };
    let n = 0;
    for (const sdef of SETTINGS) {
      if (sdef.kind !== "value") continue;
      for (const v of gen(sdef.spec)) {
        const db = (await h.admin.query(`select setting_value_ok($1::jsonb, $2::jsonb) as ok`, [JSON.stringify(sdef.spec), JSON.stringify(v)])).rows[0].ok;
        expect(db, `${sdef.key} ${JSON.stringify(v)}`).toBe(validate(sdef.spec, v) === null);
        n++;
      }
    }
    expect(n).toBeGreaterThan(300);
  });

  it("form input parses strictly and messages name the bound for every kind", () => {
    expect(parseWhole("730", false)).toBe(730);
    expect(parseWhole("36.5", false)).toBe("36.5"); // never 365
    expect(parseWhole("1.500.000", true)).toBe(1_500_000);
    expect(parseWhole("500.000", true)).toBe(500_000);
    for (const junk of ["1e3", "0x1F", "", "1,5", "1.5", "12.34"]) expect(typeof parseWhole(junk, true), junk).toBe("string");
    const form = (fields: Record<string, string[]>) => [(k: string) => fields[k]?.[0] ?? null, (k: string) => fields[k] ?? []] as const;
    const s8 = (SETTING_BY_KEY.get("SET-8") as { spec: Spec }).spec;
    expect(validate(s8, fromForm(s8, ...form({ v: ["36.5"] }), "v"))?.message).toBe("Nilai harus 30–1095 hari.");
    const s10 = (SETTING_BY_KEY.get("SET-10") as { spec: Spec }).spec;
    expect(fromForm(s10, ...form({ "v.dp_booking": ["0", "1"], "v.batas_ubah": ["24"] }), "v")).toEqual({ dp_booking: true, batas_ubah: 24 });
    expect(fromForm(s10, ...form({ "v.dp_booking": ["0"], "v.batas_ubah": ["24"] }), "v")).toEqual({ dp_booking: false, batas_ubah: 24 });
    expect(validate(s10, fromForm(s10, ...form({ "v.batas_ubah": ["24"] }), "v"))).not.toBeNull(); // tampered: no checkbox field
    const s15 = (SETTING_BY_KEY.get("SET-15") as { spec: Spec }).spec;
    expect(fromForm(s15, ...form({ v: ["20"] }), "v")).toBeNull(); // optional off without v.on
    expect(fromForm(s15, ...form({ "v.on": ["1"], v: ["20"] }), "v")).toBe(20);
    const s44 = (SETTING_BY_KEY.get("SET-44") as { spec: Spec }).spec;
    expect(fromForm(s44, ...form({ "v.k": ["day"], "v.v": ["25"] }), "v")).toEqual({ k: "day", v: 25 });
    const s23 = (SETTING_BY_KEY.get("SET-23") as { spec: Spec }).spec;
    expect(fromForm(s23, ...form({ v: ["30", "", "7"] }), "v")).toEqual([30, 7]);
    const msgs: [string, Value, RegExp][] = [
      ["SET-13", 2_000_000, /Rp0–Rp1\.000\.000/],
      ["SET-18", { h1: "06:00", sebelum: 2 }, /antara 07:00 dan 21:00/],
      ["SET-11", "manager", /Owner \/ Owner \+ Manajer/],
      ["SET-23", [14, 30], /menurun/],
      ["SET-22", { kunjungan_kedua: 90, tidak_datang: 60 }, /Kunjungan kedua harus lebih kecil dari Tidak datang/],
      ["SET-43", { void: "owner", selisih_opname: 2, po_owner: 1, musnah_kedua_kejadian: 9, musnah_kedua_bulan: 50, musnah_owner: 5 }, /\(per kejadian\) tidak boleh melewati Pemusnahan: owner mulai/],
      ["SET-43", { void: "owner", selisih_opname: 2, po_owner: 1, musnah_kedua_kejadian: 9, musnah_kedua_bulan: 5, musnah_owner: 10 }, /\(per kejadian\) tidak boleh melewati Pemusnahan: persetujuan kedua mulai \(per bulan\)/],
      ["SET-31", { merah: 40, kuning: 40, hijau: 8 }, /Merah harus lebih kecil dari Kuning/],
      ["SET-44", { k: "day", v: 29 }, /Tanggal.*1–28/],
      ["SET-40", { prefiks_loket: "a", prefiks_ruang: "B", suara: false, orientasi: "landscape" }, /1–3 huruf kapital/],
    ];
    for (const [k, v, re] of msgs) expect(validate((SETTING_BY_KEY.get(k) as { spec: Spec }).spec, v)?.message, k).toMatch(re);
    // The passing side of the ordered pairs (equal allowed for ≤, strictly less for <).
    const s43 = (SETTING_BY_KEY.get("SET-43") as { spec: Spec }).spec;
    expect(validate(s43, { void: "owner", selisih_opname: 2, po_owner: 1, musnah_kedua_kejadian: 5, musnah_kedua_bulan: 5, musnah_owner: 5 })).toBeNull();
    expect(validate((SETTING_BY_KEY.get("SET-31") as { spec: Spec }).spec, { merah: 29, kuning: 30, hijau: 8 })).toBeNull();
    // Accent input is upper-cased before validation; NBSP edges are whitespace on both sides.
    const s1 = (SETTING_BY_KEY.get("SET-1") as { spec: Spec }).spec;
    expect(fromForm(s1, ...form({ "v.aksen": ["#0a6e86"] }), "v")).toEqual({ nama: null, aksen: "#0A6E86" });
    expect(validate(s1, { nama: "\u00A0Aurelia", aksen: "#0A6E86" })).not.toBeNull();
    expect(parseWhole("0.500", true)).toBe("0.500");
  });

  it("SET-44 accepts month_end or day(1..28), defaults to month_end; the monthly cadence is fixed", async () => {
    const own = await person(A, ["owner"]);
    expect(await as(own, (db) => settingValue(db, "SET-44"))).toEqual({ k: "month_end" });
    await set(own, "SET-44", { k: "day", v: 25 });
    expect(await as(own, (db) => settingValue(db, "SET-44"))).toEqual({ k: "day", v: 25 });
    for (const ok of [1, 28]) expect(await code(set(own, "SET-44", { k: "day", v: ok })), String(ok)).toBe("ok");
    for (const bad of [0, 29, 31, 15.5]) expect(await code(set(own, "SET-44", { k: "day", v: bad })), String(bad)).toMatch(/^bounds:/);
    expect(await code(set(own, "SET-44", { k: "weekly" }))).toMatch(/^bounds:/);
    // Spec-level check: SET-44 has no cadence choice (the monthly cycle is BILL-15, fixed).
    const def = SETTING_BY_KEY.get("SET-44")!;
    expect(def.kind === "value" && JSON.stringify(def.spec)).not.toMatch(/minggu|weekly|triwulan|quarter/);
  });
});

describe("who changes what (07, 19 §5 'Changed by')", () => {
  it("roles outside the changers and drafters are refused; the editor hides those rows", async () => {
    const fo = await person(A, ["fo_cashier"], A.b1);
    expect(await code(set(fo, "SET-38", 30, A.b1))).toBe("ERR_FORBIDDEN");
    expect(await as(fo, (db) => groupRows(db, "fo_cashier", "jadwal", A.b1))).toEqual([]);
    const mgr = await person(A, ["manager"], A.b1);
    expect(await code(set(mgr, "SET-8", 400))).toBe("ERR_FORBIDDEN");
    expect((await as(mgr, (db) => groupRows(db, "manager", "jadwal", A.b1))).map((r) => r.def.key).sort()).toEqual(["SET-15", "SET-38"]);
  });

  it("a branch role changes its own branch only; a branch value overrides the tenant value", async () => {
    const mgr = await person(A, ["manager"], A.b1);
    expect(await code(set(mgr, "SET-38", 30, A.b2))).toBe("ERR_FORBIDDEN");
    expect(await code(set(mgr, "SET-38", 30, null))).toBe("ERR_FORBIDDEN");
    await set(mgr, "SET-38", 30, A.b1);
    const ap = await person(A, ["admin_pusat"]);
    await set(ap, "SET-16", { horizon: 60, batas: 4, dp_pasien_baru: true }, null);
    await set(ap, "SET-16", { horizon: 14, batas: 2, dp_pasien_baru: false }, A.b2);
    expect(await as(ap, (db) => settingValue(db, "SET-16", A.b1))).toEqual({ horizon: 60, batas: 4, dp_pasien_baru: true });
    expect(await as(ap, (db) => settingValue(db, "SET-16", A.b2))).toEqual({ horizon: 14, batas: 2, dp_pasien_baru: false });
    expect(await as(mgr, (db) => settingValue(db, "SET-38", A.b1))).toBe(30);
    expect(await as(mgr, (db) => settingValue(db, "SET-38", A.b2))).toBe(20);
    // A tenant setting has no branch value.
    const own = await person(A, ["owner"]);
    expect(await code(as(own, (db) => db.query(`select setting_set('SET-8', $1, '400'::jsonb, now(), 'cabang', false)`, [A.b1])))).toBe("raw:P0422");
  });

  it("HYG-009 N2: a tenant-wide role with a branch selected changes any branch and the tenant value, exactly as unbound; a branch role is still held to its branch", async () => {
    const at = async <R>(p: P, branch: string, fn: (db: pg.PoolClient) => Promise<R>) =>
      withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch }), fn);
    const own = await person(A, ["owner"]);
    const ap = await person(A, ["admin_pusat"]);
    // Owner bound to B1 (DEC-026: the owner changes every row).
    expect(await at(own, A.b1, (db) => changeSetting(db, { key: "SET-38", branchId: A.b2, value: 25, reason: "Owner di B1 ubah B2" }))).toMatchObject({ state: "active" });
    expect(await at(own, A.b1, (db) => changeSetting(db, { key: "SET-38", branchId: null, value: 22, reason: "Owner di B1 ubah semua cabang" }))).toMatchObject({ state: "active" });
    expect(await as(own, (db) => settingValue(db, "SET-38", A.b2))).toBe(25);
    // Admin Pusat bound to B1 keeps exactly its unbound rights: a branch row it changes, any branch.
    expect(await at(ap, A.b1, (db) => changeSetting(db, { key: "SET-16", branchId: A.b2, value: { horizon: 21, batas: 2, dp_pasien_baru: false }, reason: "AP di B1 ubah B2" }))).toMatchObject({ state: "active" });
    // ...and no more: a row it may not change stays refused whatever branch is selected.
    const unbound = await code(as(ap, (db) => changeSetting(db, { key: "SET-38", branchId: A.b2, value: 26, reason: "AP tanpa cabang" })));
    expect(await code(at(ap, A.b1, (db) => changeSetting(db, { key: "SET-38", branchId: A.b2, value: 26, reason: "AP di B1" })))).toBe(unbound);
    // Not widened here: a draft for another branch while a branch is selected is still refused, by
    // approval_request's own branch check (approvals engine, outside N2), and leaves no draft.
    const drafts = async () => Number((await h.admin.query(`select count(*) from setting_versions where tenant_id = $1 and key = 'SET-13' and state = 'draft'`, [A.tenantId])).rows[0].count);
    const d0 = await drafts();
    expect(await code(at(ap, A.b1, (db) => changeSetting(db, { key: "SET-13", branchId: A.b2, value: 66_000, reason: "Usulan AP di B1 untuk B2" })))).toBe("ERR_FORBIDDEN");
    expect(await drafts()).toBe(d0);
    // A Level 3 role stays at its branch.
    const mgr = await person(A, ["manager"], A.b1);
    expect(await code(set(mgr, "SET-38", 30, A.b2))).toBe("ERR_FORBIDDEN");
    expect(await code(set(mgr, "SET-38", 30, null))).toBe("ERR_FORBIDDEN");
  });

  it("Admin Pusat drafts a money setting; it waits in Persetujuan, the owner approves and it takes effect", async () => {
    const ap = await person(A, ["admin_pusat"]);
    const own = await person(A, ["owner"]);
    const before = await as(own, (db) => settingValue(db, "SET-20"));
    const d = await as(ap, (db) => changeSetting(db, { key: "SET-7", branchId: null, value: { jumlah: 2, hari: 14 }, reason: "Usulan dua kontrol" }));
    expect(d.state).toBe("draft");
    expect(await as(own, (db) => settingValue(db, "SET-7"))).toEqual({ jumlah: 1, hari: 7 }); // not yet
    const row = (await as(own, (db) => groupRows(db, "owner", "uang", null))).find((r) => r.def.key === "SET-7")!;
    expect(row.draft).toMatchObject({ value: { jumlah: 2, hari: 14 }, changedName: ap.name, state: "draft" });
    // A second draft while one waits is refused; the drafter cannot decide its own draft.
    expect(await code(as(ap, (db) => changeSetting(db, { key: "SET-7", branchId: null, value: { jumlah: 3, hari: 14 }, reason: "Usulan lain" })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    expect(await code(as(ap, (db) => decideDraft(db, d.approvalId!, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect(await as(own, (db) => decideDraft(db, d.approvalId!, true))).toBe("approved");
    expect(await as(own, (db) => settingValue(db, "SET-7"))).toEqual({ jumlah: 2, hari: 14 });
    // The version's own audit trail records the proposal and its application.
    expect((await h.admin.query(`select reason_code from audit_events where object_id = $1 order by seq`, [d.versionId])).rows.map((r) => r.reason_code)).toEqual(["setting_drafted", "setting_draft_applied"]);
    expect(await as(own, (db) => settingValue(db, "SET-20"))).toEqual(before);
    // Admin Pusat changes an operational row directly.
    expect((await as(ap, (db) => changeSetting(db, { key: "SET-17", branchId: null, value: 15, reason: "Bayar DP lebih lama" }))).state).toBe("active");
  });

  it("a rejected draft never applies; a withdrawn draft is cancelled", async () => {
    const ap = await person(A, ["admin_pusat"]);
    const own = await person(A, ["owner"]);
    const d = await as(ap, (db) => changeSetting(db, { key: "SET-49", branchId: null, value: 30, reason: "Perpanjangan lebih pendek" }));
    expect(await code(as(own, (db) => decideDraft(db, d.approvalId!, false)))).toBe("ERR_FORBIDDEN"); // a rejection needs a reason
    expect(await as(own, (db) => decideDraft(db, d.approvalId!, false, "Tetap 90 hari"))).toBe("rejected");
    expect(await as(own, (db) => settingValue(db, "SET-49"))).toBe(90);
    const e = await as(ap, (db) => changeSetting(db, { key: "SET-49", branchId: null, value: 60, reason: "Usulan kedua" }));
    await as(ap, (db) => cancelDraft(db, e.approvalId!));
    const states = (await h.admin.query(`select state from setting_versions where approval_id = any($1) order by created_at`, [[d.approvalId, e.approvalId]])).rows.map((r) => r.state);
    expect(states).toEqual(["rejected", "cancelled"]);
  });

  it("SET-48: the pharmacist proposes, the facility head approves (both required)", async () => {
    const ph = await person(A, ["pharmacist"], A.b1);
    const fh = await person(A, ["facility_head"], A.b1);
    const own = await person(A, ["owner"]);
    expect(await code(set(fh, "SET-48", { masa: 30, masa_akut: 7, jeda: 80, sebagian: 4 }))).toBe("ERR_FORBIDDEN");
    const d = await as(ph, (db) => changeSetting(db, { key: "SET-48", branchId: null, value: { masa: 30, masa_akut: 7, jeda: 80, sebagian: 4 }, reason: "Jeda isi ulang 80%" }));
    expect(d.state).toBe("draft");
    expect(await code(as(own, (db) => decideDraft(db, d.approvalId!, true)))).toBe("ERR_FORBIDDEN");
    expect(await as(fh, (db) => decideDraft(db, d.approvalId!, true))).toBe("approved");
    expect(await as(fh, (db) => settingValue(db, "SET-48"))).toMatchObject({ jeda: 80 });
  });

  it("a tenant-scope clinical draft is decided by a facility head of any branch; the owner only when the tenant has none (DEC-031 D2)", async () => {
    const C = await tenant();
    const ph = await person(C, ["pharmacist"], C.b1);
    const fhB2 = await person(C, ["facility_head"], C.b2);
    const own = await person(C, ["owner"]);
    const value = { masa: 30, masa_akut: 7, jeda: 85, sebagian: 4 };
    const d = await as(ph, (db) => changeSetting(db, { key: "SET-48", branchId: null, value, reason: "Jeda isi ulang 85%" }));
    // The facility head of the other branch sees it in Persetujuan and decides it.
    expect((await as(fhB2, (db) => listInbox(db, "facility_head"))).rows.map((r) => r.id)).toContain(d.approvalId);
    // The owner is not the decider while a facility head exists.
    expect(await code(as(own, (db) => decideDraft(db, d.approvalId!, true)))).toBe("ERR_FORBIDDEN");
    expect(await as(fhB2, (db) => decideDraft(db, d.approvalId!, true))).toBe("approved");
    expect(await as(own, (db) => settingValue(db, "SET-48"))).toMatchObject({ jeda: 85 });
    // A branch-scope draft of another branch stays with that branch's facility head (unchanged).
    // No facility head left in the tenant: the owner decides.
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [fhB2.staffId]);
    const e = await as(ph, (db) => changeSetting(db, { key: "SET-48", branchId: null, value: { ...value, jeda: 90 }, reason: "Jeda isi ulang 90%" }));
    expect(await as(own, (db) => decideDraft(db, e.approvalId!, true))).toBe("approved");
    expect(await as(own, (db) => settingValue(db, "SET-48"))).toMatchObject({ jeda: 90 });
    // While a facility head exists, the owner's inbox does not list the draft (no dead button).
    const fh2 = await person(C, ["facility_head"], C.b1);
    const f = await as(ph, (db) => changeSetting(db, { key: "SET-48", branchId: null, value: { ...value, jeda: 70 }, reason: "Jeda isi ulang 70%" }));
    expect((await as(own, (db) => listInbox(db, "owner"))).rows.map((r) => r.id)).not.toContain(f.approvalId);
    expect((await as(own, (db) => inboxDetail(db, { staffId: own.staffId, role: "owner" }, f.approvalId!)))?.blocked).toBe("not-approver");
    // Another tenant's facility head neither sees nor probes the draft.
    const other = await person(B, ["facility_head"], B.b1);
    expect((await as(other, (db) => listInbox(db, "facility_head"))).rows.map((r) => r.id)).not.toContain(f.approvalId);
    expect(await as(other, (db) => db.query(`select approval_is_tenant_setting_draft($1, $2) as x`, [C.tenantId, f.approvalId]))).toMatchObject({ rows: [{ x: false }] });
    expect(await as(other, (db) => db.query(`select approval_owner_decides_fh($1) as x`, [f.approvalId]))).toMatchObject({ rows: [{ x: null }] });
    expect(await code(as(other, (db) => decideDraft(db, f.approvalId!, true)))).toBe("ERR_NOT_FOUND");
    await as(fh2, (db) => decideDraft(db, f.approvalId!, true));
  });

  it("a branch clinical draft whose branch has no facility head goes to the owner (no stranded draft)", async () => {
    const E = await tenant();
    const ph = await person(E, ["pharmacist"], E.b1);
    await person(E, ["facility_head"], E.b2); // the only facility head, in another branch
    const own = await person(E, ["owner"]);
    const ver = crypto.randomUUID();
    const ap = await as(ph, (db) => db.query(`select approval_request('setting_change_fh', 'setting_version', $1, 'Uji draf cabang', $2, null) as id`, [ver, E.b1]));
    const id = ap.rows[0].id as string;
    expect((await as(own, (db) => listInbox(db, "owner"))).rows.map((r) => r.id)).toContain(id);
    expect(await as(own, (db) => db.query(`select approval_decide($1, true, null) as s`, [id]))).toMatchObject({ rows: [{ s: "approved" }] });
  });

  it("a facility head's own clinical draft goes to the owner when no other facility head exists (no deadlock)", async () => {
    const D = await tenant();
    const fh = await person(D, ["facility_head", "pharmacist"], D.b1);
    const own = await person(D, ["owner"]);
    const d = await as({ ...fh, role: "pharmacist" }, (db) => changeSetting(db, { key: "SET-48", branchId: null, value: { masa: 30, masa_akut: 7, jeda: 60, sebagian: 4 }, reason: "Jeda isi ulang 60%" }));
    expect(await code(as(fh, (db) => decideDraft(db, d.approvalId!, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect((await as(own, (db) => listInbox(db, "owner"))).rows.map((r) => r.id)).toContain(d.approvalId);
    expect(await as(own, (db) => decideDraft(db, d.approvalId!, true))).toBe("approved");
  });

  it("the draft follows its approval whichever path decides it (plain approval path, cancel)", async () => {
    const ap = await person(A, ["admin_pusat"]);
    const own = await person(A, ["owner"]);
    const d = await as(ap, (db) => changeSetting(db, { key: "SET-11", branchId: null, value: "owner_manager", reason: "Manajer ikut setujui" }));
    await as(own, (db) => decideApproval(db, d.approvalId!, true));
    expect(await as(own, (db) => settingValue(db, "SET-11"))).toBe("owner_manager");
    const e = await as(ap, (db) => changeSetting(db, { key: "SET-11", branchId: null, value: "owner", reason: "Kembali ke owner saja" }));
    await as(ap, (db) => cancelApproval(db, e.approvalId!));
    expect((await h.admin.query(`select state from setting_versions where approval_id = $1`, [e.approvalId])).rows[0].state).toBe("cancelled");
    // Not stuck: a new draft is possible right away.
    expect((await as(ap, (db) => changeSetting(db, { key: "SET-11", branchId: null, value: "owner", reason: "Usulan baru" }))).state).toBe("draft");
    // setting_draft_cancel is only for settings drafts.
    const fo = await person(A, ["fo_cashier"], A.b1);
    const refund = await as(fo, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: crypto.randomUUID() }));
    expect(await code(as(fo, (db) => cancelDraft(db, refund)))).toBe("ERR_NOT_FOUND");
  });

  it("every approval state is handled by the draft sync (a new state needs the trigger extended)", async () => {
    // setting_draft_sync maps approved/rejected/cancelled; a draft must never be left
    // waiting by an approval state the trigger does not know.
    const { rows } = await h.admin.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'approvals_state_check'`);
    expect(rows[0].d).toMatch(/'pending'.*'approved'.*'rejected'.*'cancelled'/);
    expect([...rows[0].d.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()).toEqual(["approved", "cancelled", "pending", "rejected"]);
  });

  it("two deciders of one draft at once (settings path and plain path) serialize without a deadlock", async () => {
    const ap = await person(A, ["admin_pusat"]);
    const o1 = await person(A, ["owner"]);
    const o2 = await person(A, ["owner"]);
    for (let i = 0; i < 3; i++) {
      const d = await as(ap, (db) => changeSetting(db, { key: "SET-41", branchId: null, value: { cicilan_maks: 6 + i, mundur: 1 }, reason: `Usulan cicilan ${i}` }));
      let arrived = 0;
      let open!: () => void;
      const barrier = new Promise<void>((r) => (open = r));
      const meet = async () => { if (++arrived === 2) open(); await barrier; };
      const r = await Promise.all([
        code(as(o1, async (db) => { await meet(); return decideDraft(db, d.approvalId!, true); })),
        code(as(o2, async (db) => { await meet(); return decideApproval(db, d.approvalId!, true); })),
      ]);
      // The loser gets a mapped refusal (already decided / draft gone), never a raw deadlock.
      expect(r.filter((x) => x === "ok"), `round ${i}`).toHaveLength(1);
      expect(r.find((x) => x !== "ok"), `round ${i}`).toMatch(/^ERR_(VERSION_CONFLICT|NOT_FOUND)$/);
      expect(await as(o1, (db) => settingValue(db, "SET-41"))).toEqual({ cicilan_maks: 6 + i, mundur: 1 });
    }
  });

  it("a change or restore now supersedes a value scheduled later (the latest decision wins)", async () => {
    const own = await person(A, ["owner"]);
    const later = new Date(Date.now() + 5 * 86400_000);
    await as(own, (db) => changeSetting(db, { key: "SET-35", branchId: null, value: { batas_sesi: 30, tanda_tangan: "otp" }, effectiveFrom: later, reason: "Mulai bulan depan" }));
    await as(own, (db) => changeSetting(db, { key: "SET-35", branchId: null, restore: true, reason: "Batal, kembali default" }));
    expect(await as(own, (db) => settingValue(db, "SET-35", null, new Date(later.getTime() + 1000)))).toEqual({ batas_sesi: 15, tanda_tangan: "pin" });
    const states = (await h.admin.query(`select state from setting_versions where tenant_id = $1 and key = 'SET-35' order by created_at`, [A.tenantId])).rows.map((r) => r.state);
    expect(states).toEqual(["superseded", "active"]);
  });

  it("an omitted value is refused (never silently off); a restore needs no value", async () => {
    const own = await person(A, ["owner"]);
    expect(await code(as(own, (db) => changeSetting(db, { key: "SET-15", branchId: A.b1, reason: "Tanpa nilai" })))).toMatch(/^bounds:.*belum diisi/);
  });
});

describe("versions and snapshots (DATA-6)", () => {
  it("a future change applies from its date; a value read at a past time is the one in force then", async () => {
    const own = await person(A, ["owner"]);
    const t0 = new Date();
    await set(own, "SET-21", 70);
    const later = new Date(Date.now() + 3 * 86400_000);
    await as(own, (db) => changeSetting(db, { key: "SET-21", branchId: null, value: 60, effectiveFrom: later, reason: "Mulai minggu depan" }));
    expect(await as(own, (db) => settingValue(db, "SET-21"))).toBe(70);
    expect(await as(own, (db) => settingValue(db, "SET-21", null, new Date(later.getTime() + 1000)))).toBe(60);
    expect(await as(own, (db) => settingValue(db, "SET-21", null, new Date(t0.getTime() - 60_000)))).toBe(80);
    const row = (await as(own, (db) => groupRows(db, "owner", "komunikasi", null))).find((r) => r.def.key === "SET-21")!;
    expect(row.scheduled?.value).toBe(60);
    expect(await code(as(own, (db) => changeSetting(db, { key: "SET-21", branchId: null, value: 60, effectiveFrom: new Date(Date.now() - 86400_000), reason: "Mundur" })))).toBe("ERR_FORBIDDEN");
    // More than a year ahead is refused; "now" is accepted as now.
    expect(await code(as(own, (db) => changeSetting(db, { key: "SET-21", branchId: null, value: 60, effectiveFrom: new Date(Date.now() + 400 * 86400_000), reason: "Terlalu jauh" })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(own, (db) => changeSetting(db, { key: "SET-20", branchId: null, value: 20, effectiveFrom: new Date(), reason: "Sekarang" })))).toBe("ok");
    // Branch values follow their own dates too.
    await as(own, (db) => changeSetting(db, { key: "SET-13", branchId: A.b2, value: 75_000, effectiveFrom: later, reason: "Ambang baru bulan depan" }));
    expect(await as(own, (db) => settingValue(db, "SET-13", A.b2))).toBe(50_000);
    expect(await as(own, (db) => settingValue(db, "SET-13", A.b2, new Date(later.getTime() + 1000)))).toBe(75_000);
  });

  it("history is append-only and every reader sees who changed it", async () => {
    const own = await person(A, ["owner"]);
    const { versionId } = await set(own, "SET-37", { ringkasan: "20:00", penerima: ["owner"] });
    for (const sql of [
      `update setting_versions set value = '1' where id = '${versionId}'`,
      `delete from setting_versions where id = '${versionId}'`,
      `update setting_versions set state = 'rejected', decided_at = now() where id = '${versionId}'`,
    ]) await expect(h.admin.query(sql)).rejects.toMatchObject({ code: "42501" });
    await expect(as(own, (db) => db.query(`insert into setting_versions (tenant_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason) values ($1, 'SET-8', '400', now(), 'active', $2, 'owner', 'x', 'langsung')`, [A.tenantId, own.staffId]))).rejects.toMatchObject({ code: "42501" });
    await expect(as(own, (db) => db.query(`select * from setting_defs`))).rejects.toMatchObject({ code: "42501" });
    const ap = await person(A, ["admin_pusat"]);
    const d = await as(ap, (db) => changeSetting(db, { key: "SET-6", branchId: null, value: 150_000, reason: "Biaya konsultasi" }));
    await expect(h.admin.query(`update setting_versions set value = '1' where id = $1`, [d.versionId])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`update setting_versions set reason = 'diubah' where id = $1`, [d.versionId])).rejects.toMatchObject({ code: "42501" });
    // Deciding a draft never rewrites what was proposed.
    await expect(h.admin.query(`update setting_versions set state = 'active', decided_at = now(), value = '999999' where id = $1`, [d.versionId])).rejects.toMatchObject({ code: "42501" });
    const nurse = await person(A, ["nurse"], A.b1);
    const seen = await as(nurse, (db) => db.query(`select changed_name from setting_versions where id = $1`, [versionId]));
    expect(seen.rows).toEqual([{ changed_name: own.name }]);
    // Proposals and their reasons are only for the roles that change, draft or approve
    // that setting; a nurse sees values in force only. Branch rows only in the role's branches.
    expect((await as(nurse, (db) => db.query(`select id from setting_versions where id = $1`, [d.versionId]))).rows).toEqual([]);
    expect((await as(own, (db) => db.query(`select id from setting_versions where id = $1`, [d.versionId]))).rows).toHaveLength(1);
    const mgr = await person(A, ["manager"], A.b1);
    const other = await as(own, (db) => changeSetting(db, { key: "SET-38", branchId: A.b2, value: 45, reason: "Cabang lain" }));
    expect((await as(mgr, (db) => db.query(`select id from setting_versions where id = $1`, [other.versionId]))).rows).toEqual([]);
  });
});

describe("tenant isolation", () => {
  it("another tenant's values and history are invisible and untouched", async () => {
    const ownA = await person(A, ["owner"]);
    const ownB = await person(B, ["owner"]);
    await set(ownB, "SET-20", 45);
    expect(await as(ownA, (db) => settingValue(db, "SET-20"))).not.toBe(45);
    const rowsA = await as(ownA, (db) => db.query(`select tenant_id from setting_versions`));
    expect(rowsA.rows.every((r) => r.tenant_id === A.tenantId)).toBe(true);
    // A branch of another tenant is not found.
    expect(await code(as(ownA, (db) => changeSetting(db, { key: "SET-13", branchId: B.b1, value: 10_000, reason: "Cabang lain" })))).toBe("ERR_NOT_FOUND");
    expect(await as(ownB, (db) => settingValue(db, "SET-20"))).toBe(45);
  });
});
