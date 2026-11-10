// Templat Dokumen and Surat (UX-54, PR-74, T-058): the template list and page (template_list, template_get), the
// letter list, page and form (letter_list, letter_get, letter_options), and the actions (template save and retire,
// letter create, save, sign, correct). Each run seeds in B a letter template by B's admin pusat and a fresh patient
// with a visit and a signed letter by B's doctor, then runs as the caller's own admin pusat or doctor: B's
// templates and letters are not found; every write on B's template, visit or letter is refused. As B's staff
// (positive control) everything succeeds. Synthetic data on a local database (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import {
  correctLetter, createLetter, getLetter, getTemplate, letterOptions, listLetters, listTemplates, retireTemplate, saveLetter, saveTemplate, signLetter,
} from "../../../src/modules/documents/documents";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "doctor" | "admin_pusat";
const LETTER = "{{klinik.nama}} SURAT KETERANGAN {{tanggal}} {{pasien.nama}} {{pasien.no_rm}} {{dokter.nama}} SIP {{dokter.sip}}";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.srt58.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: role === "doctor" ? "Dokter Surat" : "Admin Pusat Surat" });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "doctor") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "doctor" ? branchId : undefined });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

let runs = 0;
const latest = new Map<string, { name: string; template: string; version: string; visit: string; letter: string; draft: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  // A fresh template each run: the action case saves a version of it and retires it.
  const r = await as(env, t, b, "admin_pusat", (db) => saveTemplate(db, crypto.randomUUID(), null, { kind: "letter", letterType: "surat_keterangan", name: "Templat Rahasia", body: LETTER, paper: "a4" }));
  const tpl = { template: r.templateId, version: r.versionId };
  await member(env, t, b, "doctor");
  const staff = (await env.owner.query(`select s.id from staff s join memberships m on m.id = s.membership_id where m.account_id = $1`, [accOf.get(`${t}:doctor`)])).rows[0].id as string;
  const name = `Pasien Rahasia Surat ${t.slice(0, 8)} ${++runs}`;
  const id = crypto.randomUUID().replace(/-/g, "");
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status,
                           registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || lpad((floor(random() * 900000) + 100000)::text, 6, '0'), $2, '1990-01-01', 'female', 'nik', $5, $6, 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, name, b, staff, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)],
  )).rows[0].id as string;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, patient, staff])).rows[0].id as string;
  const doc = <T>(fn: (db: never) => Promise<T>) => as(env, t, b, "doctor", fn);
  const { letterId: letter } = await doc((db) => createLetter(db, crypto.randomUUID(), visit, tpl.version));
  await doc((db) => signLetter(db, crypto.randomUUID(), letter, { verified: true }));
  const { letterId: draft } = await doc((db) => createLetter(db, crypto.randomUUID(), visit, tpl.version));
  for (const s of [name, patient, visit, letter, draft, tpl.template, tpl.version]) env.victimSecret(s);
  const out = { name, template: tpl.template, version: tpl.version, visit, letter, draft };
  latest.set(t, out);
  return out;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const notFound = (e: unknown) => (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN") ? { status: 404, body: null } : Promise.reject(e));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });

export default defineCases(
  // The /templat index only redirects by role, and Buat Templat renders an empty form: neither reads tenant rows.
  // Their cases read what the page's data path would (the caller's own template list) and must show none of B's.
  {
    kind: "route",
    id: "/templat",
    expect: "filtered",
    marker: () => "Templat Rahasia",
    async run(env) {
      await victim(env);
      return asMine(env, "admin_pusat", (db) => listTemplates(db as never, "letter").then(ok));
    },
  },
  {
    kind: "route",
    id: "/templat/dokumen/baru",
    expect: "filtered",
    marker: () => "Templat Rahasia",
    async run(env) {
      await victim(env);
      return asMine(env, "admin_pusat", (db) => listTemplates(db as never, null).then(ok));
    },
  },
  {
    kind: "route",
    id: "/templat/dokumen",
    expect: "filtered",
    marker: () => "Templat Rahasia",
    async run(env) {
      await victim(env);
      return asMine(env, "admin_pusat", (db) => listTemplates(db as never, null).then(ok));
    },
  },
  {
    kind: "route",
    id: "/templat/dokumen/[id]",
    expect: "not-found",
    marker: () => "Templat Rahasia",
    async run(env) {
      const v = await victim(env);
      return asMine(env, "admin_pusat", (db) => getTemplate(db as never, v.template).then(ok, notFound));
    },
  },
  {
    kind: "route",
    id: "/templat/surat",
    expect: "filtered",
    marker,
    async run(env) {
      await victim(env);
      return asMine(env, "doctor", (db) => listLetters(db as never).then(ok));
    },
  },
  {
    kind: "route",
    id: "/templat/surat/[id]",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      return asMine(env, "doctor", (db) => getLetter(db as never, v.letter).then(ok, notFound));
    },
  },
  {
    kind: "route",
    id: "/templat/surat/[id]/pdf#route",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      // The handler renders the PDF from letter_get; its data path for B's letter is refused.
      return asMine(env, "doctor", (db) => getLetter(db as never, v.letter).then(ok, notFound));
    },
  },
  {
    kind: "route",
    id: "/templat/surat/baru",
    expect: "filtered",
    marker,
    async run(env) {
      const v = await victim(env);
      return asMine(env, "doctor", (db) => letterOptions(db as never, v.visit).then(ok));
    },
  },
  {
    kind: "action",
    id: "app/(app)/templat/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      // Letter writes first (they need the active template version), then the template ones.
      const attempts = {
        createLetter: await outcome(asMine(env, "doctor", (db) => createLetter(db as never, k(), v.visit, v.version))),
        saveLetter: await outcome(asMine(env, "doctor", (db) => saveLetter(db as never, k(), v.draft, "Isi surat lintas tenant"))),
        signLetter: await outcome(asMine(env, "doctor", (db) => signLetter(db as never, k(), v.draft, { verified: true }))),
        correctLetter: await outcome(asMine(env, "doctor", (db) => correctLetter(db as never, k(), v.letter, "Isi surat lintas tenant", "Coba lintas"))),
        saveTemplate: await outcome(asMine(env, "admin_pusat", (db) => saveTemplate(db as never, k(), v.template, { body: LETTER, paper: "a4" }))),
        retireTemplate: await outcome(asMine(env, "admin_pusat", (db) => retireTemplate(db as never, k(), v.template))),
      };
      const read = await asMine(env, "doctor", (db) => getLetter(db as never, v.letter).then((x) => x.patient_name, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
