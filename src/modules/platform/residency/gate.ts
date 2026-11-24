// Real-patient gate (ARCH-10, PR-36, PRIV-5, PR-97; T-120).
// Pure specification + database bindings for residency attestation and real-patient write gating.
// In production (when EITHER app.deploy_env OR platform_environment indicates production — fail closed),
// real-patient writes (patient registration, online booking/hold confirmation, T-128 opening import)
// are allowed ONLY when ALL hold:
//   1. every storage kind is configured in runtime env and matches vendor_profile.storage_locations,
//      attested in residency_attestations for deploy_env='production' and the running APP_RELEASE_DIGEST;
//   2. every deployed and declared location is in Indonesia (ID), OR vendor_profile.residency_opinion_outcome
//      is 'positive' AND compliance item vendor_residency_opinion is approved, unexpired on Jakarta wall clock,
//      matches the current storage_locations config_version, AND its file_sha256 equals residency_opinion_checksum;
//   3. vendor obligation vendor_processor_agreement_template is approved & unexpired on Jakarta wall clock;
//   4. tenant obligations processor_agreement_signed, dpia, appointment_dpo are approved & unexpired for this tenant.
import type pg from "pg";
import { deployEnv, type DeployEnv } from "../../vendor/profile/profile";
import {
  type DeployedConfig,
  effectiveResidencyConfig,
  type Location,
  matchDeclared,
  type Mismatch,
  type StorageKind,
} from "./config";

export type { DeployEnv };
export const envOf = (v: string | undefined): DeployEnv =>
  (v === "staging" || v === "demo" || v === "local" ? v : "production");

export type Opinion = {
  outcome: "positive" | "negative" | "inconclusive" | null;
  evidenceApproved: boolean;
  checksumMatches?: boolean;
};

export const VENDOR_OBLIGATIONS = ["vendor_processor_agreement_template"] as const;
export const TENANT_OBLIGATIONS = ["processor_agreement_signed", "dpia", "appointment_dpo"] as const;
export type Obligation = (typeof VENDOR_OBLIGATIONS)[number] | (typeof TENANT_OBLIGATIONS)[number];

export type GateInput = {
  env: DeployEnv;
  dbEnv?: DeployEnv;
  deployed: DeployedConfig;
  declared: Location[];
  opinion: Opinion;
  approved: ReadonlySet<Obligation>;
  attested?: boolean;
};

export type Blocker =
  | { code: "config_missing" | "config_invalid"; kind: StorageKind; field: string }
  | { code: "location_mismatch"; kind: StorageKind; problem: Mismatch["problem"] }
  | { code: "unattested" }
  | { code: "opinion_required" | "opinion_negative" | "opinion_inconclusive" | "opinion_unapproved"; outside: StorageKind[] }
  | { code: "obligation_missing"; obligation: Obligation };

export type GateResult = { open: true; blockers: [] } | { open: false; blockers: Blocker[] };

export function evaluateGate(i: GateInput): GateResult {
  const effectiveDbEnv = i.dbEnv ?? i.env;
  if (i.env !== "production" && effectiveDbEnv !== "production") return { open: true, blockers: [] };
  const blockers: Blocker[] = [];
  for (const x of i.deployed.issues) {
    blockers.push({ code: x.problem === "missing" ? "config_missing" : "config_invalid", kind: x.kind, field: x.field });
  }
  for (const m of matchDeclared(i.deployed.locations, i.declared)) {
    blockers.push({ code: "location_mismatch", kind: m.kind, problem: m.problem });
  }
  if (i.attested === false) blockers.push({ code: "unattested" });
  const known = new Map(i.deployed.locations.map((l) => [l.kind, l.country]));
  const kinds = [...new Set([...i.deployed.locations.map((l) => l.kind), ...i.deployed.issues.map((x) => x.kind)])];
  const outside = kinds.filter((k) => known.get(k) !== "ID");
  if (outside.length > 0) {
    const o = i.opinion;
    if (o.outcome === null) blockers.push({ code: "opinion_required", outside });
    else if (o.outcome === "negative") blockers.push({ code: "opinion_negative", outside });
    else if (o.outcome === "inconclusive") blockers.push({ code: "opinion_inconclusive", outside });
    else if (!o.evidenceApproved || o.checksumMatches === false) blockers.push({ code: "opinion_unapproved", outside });
  }
  for (const ob of [...VENDOR_OBLIGATIONS, ...TENANT_OBLIGATIONS]) {
    if (!i.approved.has(ob)) blockers.push({ code: "obligation_missing", obligation: ob });
  }
  return blockers.length === 0 ? { open: true, blockers: [] } : { open: false, blockers };
}

export const KIND_LABEL: Record<StorageKind, string> = {
  database: "database",
  object_storage: "penyimpanan berkas",
  backups: "backup",
  logs: "log",
  error_tracking: "pelacakan error",
};
const FIELD_LABEL: Record<string, string> = { provider: "penyedia", region: "region", country: "negara" };
export const OBLIGATION_LABEL: Record<Obligation, string> = {
  vendor_processor_agreement_template: "Templat perjanjian pengolahan data (vendor)",
  processor_agreement_signed: "Perjanjian pengolahan data yang ditandatangani klinik",
  dpia: "Penilaian dampak pelindungan data (DPIA)",
  appointment_dpo: "Penunjukan pejabat pelindungan data",
};

const kindsText = (ks: StorageKind[]) => ks.map((k) => KIND_LABEL[k]).join(", ");

export function blockerText(b: Blocker): string {
  switch (b.code) {
    case "config_missing": return `Lokasi ${KIND_LABEL[b.kind]} belum dikonfigurasi (${FIELD_LABEL[b.field] ?? b.field})`;
    case "config_invalid": return `Konfigurasi lokasi ${KIND_LABEL[b.kind]} tidak valid (${FIELD_LABEL[b.field] ?? b.field})`;
    case "location_mismatch":
      return b.problem === "undeclared"
        ? `Lokasi ${KIND_LABEL[b.kind]} belum dinyatakan di Profil Vendor`
        : b.problem === "ambiguous"
          ? `Profil Vendor menyatakan lebih dari satu lokasi ${KIND_LABEL[b.kind]}`
          : `Lokasi ${KIND_LABEL[b.kind]} yang berjalan berbeda dengan yang dinyatakan di Profil Vendor`;
    case "unattested": return "Lokasi penyimpanan terpasang belum terverifikasi untuk rilis yang berjalan";
    case "opinion_required": return `Pendapat hukum lokasi data belum ada, padahal ${kindsText(b.outside)} berada di luar Indonesia`;
    case "opinion_negative": return `Pendapat hukum lokasi data negatif untuk ${kindsText(b.outside)} di luar Indonesia`;
    case "opinion_inconclusive": return `Pendapat hukum lokasi data tidak tegas untuk ${kindsText(b.outside)} di luar Indonesia`;
    case "opinion_unapproved": return "Pendapat hukum lokasi data belum disetujui di Kepatuhan untuk lokasi dan berkas yang berlaku sekarang";
    case "obligation_missing": return `${OBLIGATION_LABEL[b.obligation]} belum disetujui`;
  }
}

export function refusalText(action: "activation" | "patient" | "import" | "booking", r: GateResult): string | null {
  if (r.open) return null;
  const what = {
    activation: "Klinik belum dapat diaktifkan untuk data pasien sungguhan",
    patient: "Pasien sungguhan belum dapat didaftarkan",
    import: "Impor data pasien belum dapat dijalankan",
    booking: "Booking publik belum dapat dibuka",
  }[action];
  return `${what}: ${r.blockers.map(blockerText).join("; ")}.`;
}

export function blockerCode(b: Blocker): string {
  switch (b.code) {
    case "config_missing":
    case "config_invalid":
      return `residency:${b.code}:${b.kind}.${b.field}`;
    case "location_mismatch":
      return `residency:location_mismatch:${b.kind}`;
    case "unattested":
      return "residency:unattested";
    case "opinion_required":
    case "opinion_negative":
    case "opinion_inconclusive":
    case "opinion_unapproved":
      return `residency:${b.code}`;
    case "obligation_missing":
      return `obligation:${b.obligation}`;
  }
}

// ── Database bindings (migration 0133_real_patient_gate) ───────────────────────────────────────
// Transaction-local binding called by guarded app writers (patient_register, booking_create,
// booking_confirm, deposit_receive, and later T-126/T-128). Always fails closed on missing values.
export async function bindResidencyContext(
  db: pg.ClientBase,
  env: Partial<Record<string, string>> = process.env,
): Promise<void> {
  const dEnv = deployEnv(env);
  const cfg = effectiveResidencyConfig(env);
  const digest = cfg.releaseDigest ?? "";
  const locDigest = cfg.locationsDigest ?? "";
  await db.query(
    `select set_config('app.deploy_env', $1, true), set_config('app.release_digest', $2, true), set_config('app.residency_config', $3, true)`,
    [dEnv, digest, locDigest],
  );
}

// Deploy/migration-owner-only attestation: compares effectiveResidencyConfig(env) against the locked
// vendor_profile.storage_locations row and stamps residency_attestations(id=1). Never granted to clinic_app.
export type AttestResult = {
  matched: boolean;
  mismatches: { kind: string; problem: string }[];
  configVersion: string;
  releaseDigest: string;
  deployedLocationsDigest: string | null;
};
export async function attestResidency(
  ownerDb: pg.ClientBase,
  env: Partial<Record<string, string>> = process.env,
): Promise<AttestResult> {
  const cfg = effectiveResidencyConfig(env);
  const dEnv = deployEnv(env);
  if (!cfg.releaseDigest) {
    throw new Error("APP_RELEASE_DIGEST is required (16..128 lowercase hex) to attest residency");
  }
  const { rows } = await ownerDb.query<{
    r: {
      matched: boolean;
      mismatches: { kind: string; problem: string }[];
      config_version: string;
      release_digest: string;
      deployed_locations_digest: string | null;
    };
  }>(
    `select public.residency_attest($1::jsonb, $2, $3) as r`,
    [JSON.stringify(cfg.locations), dEnv, cfg.releaseDigest],
  );
  const r = rows[0].r;
  return {
    matched: r.matched,
    mismatches: r.mismatches,
    configVersion: r.config_version,
    releaseDigest: r.release_digest,
    deployedLocationsDigest: r.deployed_locations_digest,
  };
}

// Deploy/migration-owner-only database environment marker (Finding #5).
export async function setPlatformEnvironment(ownerDb: pg.ClientBase, env: DeployEnv): Promise<void> {
  await ownerDb.query(
    `insert into public.platform_environment (id, deploy_env, set_at) values (1, $1, clock_timestamp())
     on conflict (id) do update set deploy_env = excluded.deploy_env, set_at = clock_timestamp()`,
    [env],
  );
}

// Tenant-bound reader for owner / Admin Pusat (Kepatuhan screen).
export async function realPatientGateStatus(db: pg.ClientBase, env: Partial<Record<string, string>> = process.env): Promise<string[]> {
  await bindResidencyContext(db, env);
  const { rows } = await db.query<{ b: string[] }>(`select public.real_patient_gate_status() as b`);
  return rows[0].b;
}
