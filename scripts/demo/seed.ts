// HYG-DEMO-1 resettable synthetic staging demo seed (DEC-034, MIG-2).
// Writes ONLY through the application's own domain writers, vendor provisioning/onboarding/
// go-live writers, RLS contexts, Better Auth account/TOTP flows (with production rate limiting
// enabled), and the real ledger outbox posting consumer — zero direct INSERTs into domain
// tables — so sub-ledgers, General Ledger, stock, commission, and KPIs reconcile cleanly.
// Safety invariants:
// - Fails closed unless DEPLOY_ENV === "staging", platform_environment === "staging",
//   residency_attestations exists with zero production rows, and database is empty.
// - Holds a live READ COMMITTED fence transaction (`SEED_LOCK_KEY` + per-run random probe
//   lock + SHARE locks on platform_environment & residency_attestations) for the entire run,
//   blocking concurrent production transitions and forcing resets to wait for seed to quiesce.
// - Wraps ALL four connection pools (`owner`, `app`, `auth`, `vendor`) with per-physical-
//   connection verification + fence-liveness checks before any SQL executes, aborting
//   immediately on replacement-connection drift or fence loss.
// - Verifies ledger posting completeness from ledger-eligible `domain_events` LEFT JOIN
//   `event_receipts` BEFORE writing 0600 out-of-repo credentials.
import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import pg from "pg";
import { ROLES, TOTP_ROLES, type Role } from "../../src/auth/policy";
import { createAuth, VENDOR_AUTH_BASE_PATH, type Auth, type StepUp } from "../../src/auth/server";
import {
  APP_GROUP_ROLE,
  AUTH_GROUP_ROLE,
  VENDOR_GROUP_ROLE,
  withTenantContext,
  type SessionBinding,
} from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { LEDGER_CONSUMER, ledgerPostingConsumer } from "../../src/modules/accounting/ledger/posting";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { releaseAddition } from "../../src/modules/cashier/additions/additions";
import { receiveDeposit } from "../../src/modules/cashier/deposits/deposits";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { collectReceivable, convertToReceivable } from "../../src/modules/cashier/receivables/receivables";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { flagComplaint } from "../../src/modules/clinical/complaints/complaints";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { openIntake, saveIntake, sendIntake } from "../../src/modules/clinical/intake/intake";
import { signRecord } from "../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import {
  assignGuidingBc,
  attributeSale,
  createRule,
  decideRuleVersion,
  openBatch,
} from "../../src/modules/commission/commission";
import { setStaffTarget } from "../../src/modules/commission/targets/targets";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { runFollowupScan } from "../../src/modules/crm/followups/scan";
import { createLead, setLeadStage } from "../../src/modules/crm/leads/leads";
import { recordSurvey } from "../../src/modules/crm/surveys/surveys";
import { recordExpense, saveExpenseCategory } from "../../src/modules/expenses/expenses";
import { receiveCosted } from "../../src/modules/inventory/costing/costing";
import { createDepot, listDepots, transferBetweenDepots } from "../../src/modules/inventory/depots/depots";
import { recordCount, saveItem, setLevel, startCount, submitCount } from "../../src/modules/inventory/stock";
import {
  createBranch,
  setHours,
  setServices,
  updateProfile as updateBranchProfile,
  upsertDevice,
  upsertRoom,
} from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext, roleSource } from "../../src/modules/org/identity";
import { decideCredential, recordCredential } from "../../src/modules/org/licences/licences";
import { acceptOwnerWithNewAccount } from "../../src/modules/org/staff/staff";
import { reserveSession, setPackageContents, topUpBalance } from "../../src/modules/packages/packages";
import { grantConsent, publishConsentText } from "../../src/modules/patients/consents/consents";
import { registerPatient, sealIdentity, type RegistrationFields } from "../../src/modules/patients/patients";
import { CHECKS, confirmSelection, handOver, prepareDispensing } from "../../src/modules/pharmacy/pharmacy";
import { createPromoCode } from "../../src/modules/promo/promo";
import { receiveGoods, recordInvoice, savePurchaseOrder, sendPurchaseOrder } from "../../src/modules/purchasing/payables/payables";
import { saveSupplier } from "../../src/modules/purchasing/suppliers/suppliers";
import { recordEntry, reportIncident } from "../../src/modules/safety/safety";
import { cancelAppointment, confirmAttendance, reschedule } from "../../src/modules/scheduling/appointments/appointments";
import { book, slots } from "../../src/modules/scheduling/booking/booking";
import { setWeek, type ShiftRow } from "../../src/modules/scheduling/rosters/rosters";
import { addToWaitlist } from "../../src/modules/scheduling/waitlist/waitlist";
import { changeSetting } from "../../src/modules/settings/settings";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { checklist, OPTIONAL_ITEMS, setChecklistItem } from "../../src/modules/vendor/checklist/checklist";
import { updateProfile as updateVendorProfile } from "../../src/modules/vendor/profile/profile";
import { bootstrapVendor, createVendorStaff } from "../../src/modules/vendor/staff/staff";
import { advanceTenant, approveOwnerInvite, createTenant } from "../../src/modules/vendor/tenants/tenants";
import { walkIn } from "../../src/modules/visits/queue/queue";
import { closeVisit } from "../../src/modules/visits/visits";
import { runOutboxBatch } from "../../src/workers/outbox";
import {
  assertNotSeeded,
  assertOutsideRepo,
  assertSameClusterAndDatabase,
  assertStagingOnly,
  DemoAlreadySeededError,
  DemoGuardError,
  generateDemoPassword,
  guardVerifiedPool,
  randomAdvisoryLockKey,
  readDbIdentity,
  SEED_LOCK_KEY,
  writeCredentialsFile,
  type DemoEnv,
} from "./guard";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const LEVEL2_ROLES = new Set<Role>([
  "owner",
  "admin_pusat",
  "finance",
  "central_cs",
  "marketing",
  "purchasing",
  "auditor",
]);

const ROLE_DISPLAY_NAMES: Record<Role, string> = {
  owner: "Rania Prameswari (Owner)",
  admin_pusat: "Dimas Mahendra (Admin Pusat)",
  manager: "Nadia Kartika (Manajer Kemang)",
  facility_head: "dr. Hendra Wijaya (Penanggung Jawab)",
  records_officer: "Siti Rahmawati (Perekam Medis)",
  fo_cashier: "Rina Oktaviani (FO/Kasir Kemang)",
  central_cs: "Ayu Lestari (CS Pusat)",
  bc: "Tiara Anindya (Beauty Consultant)",
  doctor: "dr. Larasati Kusuma (Dokter)",
  nurse: "Putri Handayani (Perawat)",
  therapist: "Wulan Sari (Terapis)",
  pharmacist: "apt. Bagas Pratama (Apoteker)",
  finance: "Fajar Nugroho (Keuangan)",
  marketing: "Kirana Dewi (Marketing)",
  purchasing: "Reza Kurniawan (Pembelian)",
  auditor: "Budi Santoso (Auditor Internal)",
};

const ROLE_EMAIL_SLUG: Record<Role, string> = {
  owner: "owner",
  admin_pusat: "admin-pusat",
  manager: "manajer",
  facility_head: "pj-klinik",
  records_officer: "rekam-medis",
  fo_cashier: "fo",
  central_cs: "cs",
  bc: "bc",
  doctor: "dokter",
  nurse: "perawat",
  therapist: "terapis",
  pharmacist: "apoteker",
  finance: "keuangan",
  marketing: "marketing",
  purchasing: "pembelian",
  auditor: "auditor",
};

const CLINICAL_GO_LIVE_OBLIGATIONS = [
  "clinical_authority_matrix",
  "sop_downtime",
  "sop_incident",
  "sop_waste",
  "appointment_responsible_person",
  "appointment_pharmacist",
] as const;

const OWNER_OPERATIONS_OBLIGATIONS = new Set<string>(["sop_downtime", "sop_incident"]);

// 30 synthetic Indonesian patient names (MIG-2: purely fictitious, synthetic NIK 9999..., synthetic phone +628110000...)
const SYNTHETIC_PATIENTS: readonly {
  name: string;
  birthDate: string;
  sex: "female" | "male";
  occupation: string;
  marital: "belum_kawin" | "kawin";
  minor?: boolean;
}[] = [
  { name: "Adinda Puspita", birthDate: "1993-04-12", sex: "female", occupation: "Desainer Grafis", marital: "belum_kawin" },
  { name: "Bunga Maharani", birthDate: "1989-08-21", sex: "female", occupation: "Manajer Pemasaran", marital: "kawin" },
  { name: "Citra Anggraini", birthDate: "1996-02-05", sex: "female", occupation: "Arsitek", marital: "belum_kawin" },
  { name: "Dewi Permatasari", birthDate: "1985-11-17", sex: "female", occupation: "Pengusaha", marital: "kawin" },
  { name: "Eka Wulandari", birthDate: "1991-06-30", sex: "female", occupation: "Akuntan", marital: "kawin" },
  { name: "Farah Nabila", birthDate: "1998-01-14", sex: "female", occupation: "Konsultan", marital: "belum_kawin" },
  { name: "Gita Savitri", birthDate: "1992-09-03", sex: "female", occupation: "Dokter Gigi", marital: "kawin" },
  { name: "Hana Kusumawati", birthDate: "1987-03-25", sex: "female", occupation: "Notaris", marital: "kawin" },
  { name: "Intan Cahyani", birthDate: "1995-07-09", sex: "female", occupation: "Analis Data", marital: "belum_kawin" },
  { name: "Jasmine Putri", birthDate: "1999-12-19", sex: "female", occupation: "Mahasiswa", marital: "belum_kawin" },
  { name: "Kartika Sari", birthDate: "1988-05-11", sex: "female", occupation: "Dosen", marital: "kawin" },
  { name: "Laras Widyasari", birthDate: "1994-10-28", sex: "female", occupation: "Penulis", marital: "belum_kawin" },
  { name: "Maya Oktavia", birthDate: "1990-02-14", sex: "female", occupation: "HRD", marital: "kawin" },
  { name: "Nadia Syifa", birthDate: "1997-08-06", sex: "female", occupation: "Apoteker", marital: "belum_kawin" },
  { name: "Olivia Tanuwijaya", birthDate: "1986-04-02", sex: "female", occupation: "Direktur", marital: "kawin" },
  { name: "Priska Ramadhani", birthDate: "1993-11-23", sex: "female", occupation: "Bankir", marital: "kawin" },
  { name: "Qory Amalia", birthDate: "1995-01-18", sex: "female", occupation: "Product Manager", marital: "belum_kawin" },
  { name: "Raisa Fadillah", birthDate: "1991-07-29", sex: "female", occupation: "Pengacara", marital: "kawin" },
  { name: "Salsa Khairunnisa", birthDate: "2000-03-10", sex: "female", occupation: "Kreator Konten", marital: "belum_kawin" },
  { name: "Tania Setiawan", birthDate: "1989-06-15", sex: "female", occupation: "Karyawan Swasta", marital: "kawin" },
  { name: "Utami Rahayu", birthDate: "1984-09-22", sex: "female", occupation: "Wiraswasta", marital: "kawin" },
  { name: "Vania Susanto", birthDate: "1996-12-01", sex: "female", occupation: "Insinyur Perangkat Lunak", marital: "belum_kawin" },
  { name: "Widya Ningsih", birthDate: "1992-05-08", sex: "female", occupation: "Guru", marital: "kawin" },
  { name: "Yulia Pratiwi", birthDate: "1988-10-12", sex: "female", occupation: "Manajer Operasional", marital: "kawin" },
  { name: "Zahra Aulia", birthDate: "1997-04-27", sex: "female", occupation: "Perencana Keuangan", marital: "belum_kawin" },
  { name: "Arif Budiman", birthDate: "1990-07-16", sex: "male", occupation: "Konsultan IT", marital: "kawin" },
  { name: "Bayu Pratama", birthDate: "1993-02-20", sex: "male", occupation: "Pengusaha", marital: "belum_kawin" },
  { name: "Chandra Wijaya", birthDate: "1986-11-04", sex: "male", occupation: "Eksekutif", marital: "kawin" },
  { name: "Kayla Azzahra", birthDate: "2011-05-14", sex: "female", occupation: "Pelajar", marital: "belum_kawin", minor: true },
  { name: "Nayla Salsabila", birthDate: "2012-09-09", sex: "female", occupation: "Pelajar", marital: "belum_kawin", minor: true },
];

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — standard node:crypto implementation, zero extra deps.
export function totp(base32Secret: string, atMs = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32Secret.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const keyBytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < keyBytes.length; i++) {
    keyBytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const digest = createHmac("sha1", keyBytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

function secretFromOtpAuthUri(uri: string): string {
  const s = new URL(uri).searchParams.get("secret");
  if (!s) throw new Error("totpURI missing secret");
  return s;
}

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Valid, browser-renderable 640x240 8-bit grayscale PNG showing a crisp synthetic signature
// line on a white canvas (complete IHDR + zlib-compressed IDAT + IEND with valid CRC32).
export function demoPng(): Buffer {
  const width = 640;
  const height = 240;
  const stride = 1 + width; // filter byte (0) + grayscale pixels
  const raw = Buffer.alloc(height * stride, 255);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // None filter
  }
  // Draw a smooth synthetic signature curve across the canvas so it is visibly rendered.
  for (let x = 70; x < 570; x++) {
    const cy = Math.round(120 + 28 * Math.sin(x / 32) + 10 * Math.cos(x / 13));
    for (let dy = -2; dy <= 2; dy++) {
      const yy = cy + dy;
      if (yy >= 0 && yy < height) raw[yy * stride + 1 + x] = 28;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // non-interlaced
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Valid single-page PDF 1.4 document with accurate xref byte offsets, readable by PDF viewers.
export function demoPdf(title: string): Buffer {
  const safeTitle = title.replace(/[()\\]/g, " ").replace(/[^\x20-\x7e]/g, " ");
  const stream = `BT\n/F1 14 Tf\n54 740 Td\n(${safeTitle}) Tj\n0 -24 Td\n/F1 10 Tf\n(Synthetic staging compliance document - MIG-2) Tj\nET\n`;
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream\nendobj\n`,
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [0];
  let cursor = chunks[0].length;
  for (const obj of objects) {
    offsets.push(cursor);
    const b = Buffer.from(obj, "latin1");
    chunks.push(b);
    cursor += b.length;
  }
  const xrefStart = cursor;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (let i = 1; i < offsets.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  xrefLines.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  chunks.push(Buffer.from(xrefLines.join(""), "latin1"));
  return Buffer.concat(chunks);
}

export class AuthSessionClient {
  cookies = new Map<string, string>();
  constructor(
    private readonly auth: Auth,
    private readonly baseUrl: string,
    private readonly basePath: string,
    readonly ip: string,
  ) {}

  headers(): Headers {
    const h = new Headers({ origin: this.baseUrl, "x-real-ip": this.ip });
    if (this.cookies.size) {
      h.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    return h;
  }

  async post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const h = this.headers();
    h.set("content-type", "application/json");
    const res = await this.auth.auth.handler(
      new Request(`${this.baseUrl}${this.basePath}${path}`, {
        method: "POST",
        headers: h,
        body: JSON.stringify(body),
      }),
    );
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const idx = pair.indexOf("=");
      const name = pair.slice(0, idx);
      const val = pair.slice(idx + 1);
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim())) || val === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, val);
    }
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }
}

function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function mondayOfWeek(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(ymd, diff);
}

export type SeedAccountSummary = {
  role: Role | "platform_owner" | "vendor_onboarding";
  email: string;
  displayName: string;
  accountId: string;
  staffId: string;
  branches: string[];
  totpEnrolled: boolean;
};

export type SeedSummary = {
  tenantId: string;
  branches: { id: string; code: string; name: string }[];
  vendorOwnerStaffId: string;
  vendorOnboardingStaffId: string;
  accounts: SeedAccountSummary[];
  credentialsFile: string;
  counts: {
    staff: number;
    services: number;
    products: number;
    packages: number;
    patients: number;
    appointments: number;
    visits: number;
    expenses: number;
    leads: number;
    complaints: number;
    incidents: number;
    stockItems: number;
  };
  outboxDrained: {
    eligible: number;
    missingReceipt: number;
    done: number;
    pending: number;
    leased: number;
    deadLetter: number;
    journalEntries: number;
    skipped: number;
    failed: number;
  };
};

export type SeedStagingHooks = {
  // Test-only seam: invoked right after the staging fence transaction and verified pools are
  // established, before any writes run (enables deterministic fence-loss tests).
  onFenceAcquired?: (info: { fencePid: number }) => Promise<void>;
};

export type SeedStagingOptions = {
  ownerDatabaseUrl: string;
  appDatabaseUrl: string;
  authDatabaseUrl: string;
  vendorDatabaseUrl: string;
  credentialsOutputPath: string;
  appUrl: string;
  vendorUrl: string;
  authSecret: string;
  vendorAllowlistCidr: string;
  repoRoot?: string;
  env?: DemoEnv;
  hooks?: SeedStagingHooks;
};

export async function seedStagingDemo(opts: SeedStagingOptions): Promise<SeedSummary> {
  const env = opts.env ?? process.env;
  const repoRoot = opts.repoRoot ?? REPO_ROOT;

  // Fail fast on missing/weak explicit deployed auth configuration or in-repo credentials path.
  if (!opts.authSecret || opts.authSecret.length < 32) {
    throw new DemoGuardError("INVALID_AUTH_CONFIG", "REFUSED: authSecret (>= 32 chars) from deployed config is required");
  }
  if (!opts.vendorAllowlistCidr || !opts.vendorAllowlistCidr.trim()) {
    throw new DemoGuardError("INVALID_AUTH_CONFIG", "REFUSED: vendorAllowlistCidr is required");
  }
  try {
    new URL(opts.appUrl);
    new URL(opts.vendorUrl);
  } catch {
    throw new DemoGuardError("INVALID_AUTH_CONFIG", "REFUSED: valid appUrl and vendorUrl are required");
  }
  assertOutsideRepo(opts.credentialsOutputPath, repoRoot);

  const ownerPool = new pg.Pool({ connectionString: opts.ownerDatabaseUrl, max: 4 });
  ownerPool.on("error", () => {});
  ownerPool.on("connect", (c) => c.on("error", () => {}));

  let appPool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let vendorPool: pg.Pool | undefined;
  let seedLockClient: pg.PoolClient | undefined;
  let fenceLost: Error | null = null;
  let expectedFenceClose = false;
  let inFenceTx = false;
  const runProbeKey = randomAdvisoryLockKey();

  const assertFenceAlive = () => {
    if (fenceLost) {
      throw new DemoGuardError("FENCE_LOST", `REFUSED: seed fence session lost; aborting (${fenceLost.message})`);
    }
  };

  try {
    // 1. Open a dedicated fence transaction holding:
    //    - SEED_LOCK_KEY (serializes concurrent seed/reset runs)
    //    - runProbeKey (proves live same-cluster & same-database on every physical connection)
    //    - SHARE table locks on platform_environment & residency_attestations (blocks any
    //      concurrent production transition AND forces reset to wait for in-flight seed writes)
    seedLockClient = await ownerPool.connect();
    seedLockClient.on("error", (err) => {
      if (!expectedFenceClose) fenceLost ??= err;
    });
    seedLockClient.on("end", () => {
      if (!expectedFenceClose) fenceLost ??= new Error("fence session closed unexpectedly");
    });

    await seedLockClient.query(`begin isolation level read committed`);
    inFenceTx = true;

    const lockRes = await seedLockClient.query<{ acquired: boolean }>(
      `select pg_try_advisory_xact_lock($1) as acquired`,
      [SEED_LOCK_KEY],
    );
    if (!lockRes.rows[0]?.acquired) {
      throw new DemoAlreadySeededError("REFUSED: another staging demo seed run is already in progress");
    }
    await seedLockClient.query(`select pg_advisory_xact_lock($1)`, [runProbeKey]);

    // Check required marker tables exist before acquiring SHARE locks.
    const tableCheck = await seedLockClient.query<{ env_t: string | null; attest_t: string | null }>(
      `select to_regclass('public.platform_environment')::text as env_t,
              to_regclass('public.residency_attestations')::text as attest_t`,
    );
    if (!tableCheck.rows[0]?.env_t || !tableCheck.rows[0]?.attest_t) {
      throw new DemoGuardError(
        "MISSING_DB_ENV_MARKER",
        "REFUSED: public.platform_environment or public.residency_attestations table is missing",
      );
    }
    await seedLockClient.query(
      `lock table public.platform_environment, public.residency_attestations in share mode`,
    );

    // Fresh post-lock checks inside READ COMMITTED fence transaction.
    await assertStagingOnly(seedLockClient, env);
    await assertNotSeeded(seedLockClient);
    const ownerIdentity = await readDbIdentity(seedLockClient);
    const fencePid = (await seedLockClient.query<{ pid: number }>(`select pg_backend_pid() as pid`)).rows[0].pid;

    const bypassClients = new WeakSet<pg.PoolClient>([seedLockClient]);

    // 2. Wrap ALL four pools (including ownerPool for secondary owner clients like opClient)
    //    so EVERY physical connection (initial or replacement) is verified against the fence
    //    AND checks fence liveness before any SQL executes.
    guardVerifiedPool(ownerPool, {
      leaderIdentity: ownerIdentity,
      label: "ownerDatabaseUrl",
      runProbeKey,
      assertFenceAlive,
      bypassClients,
    });
    appPool = guardVerifiedPool(await openAppPool({ connectionString: opts.appDatabaseUrl, max: 6 }, APP_GROUP_ROLE), {
      leaderIdentity: ownerIdentity,
      label: "appDatabaseUrl",
      runProbeKey,
      assertFenceAlive,
    });
    authPool = guardVerifiedPool(
      await openAppPool({ connectionString: opts.authDatabaseUrl, max: 4 }, AUTH_GROUP_ROLE),
      {
        leaderIdentity: ownerIdentity,
        label: "authDatabaseUrl",
        runProbeKey,
        assertFenceAlive,
      },
    );
    vendorPool = guardVerifiedPool(
      await openAppPool({ connectionString: opts.vendorDatabaseUrl, max: 4 }, VENDOR_GROUP_ROLE),
      {
        leaderIdentity: ownerIdentity,
        label: "vendorDatabaseUrl",
        runProbeKey,
        assertFenceAlive,
      },
    );

    // Eagerly prove an initial connection on each secondary pool before any write starts.
    for (const [label, pool] of [
      ["appDatabaseUrl", appPool],
      ["authDatabaseUrl", authPool],
      ["vendorDatabaseUrl", vendorPool],
    ] as const) {
      const c = await pool.connect();
      try {
        await assertSameClusterAndDatabase(ownerIdentity, c, label, runProbeKey);
      } finally {
        c.release();
      }
    }

    if (opts.hooks?.onFenceAcquired) {
      await opts.hooks.onFenceAcquired({ fencePid });
    }
    assertFenceAlive();

    // Both Better Auth instances run with production rate limiting ENABLED (database storage);
    // each synthetic clinic account uses its own RFC 5737 client IP during enrolment.
    const appAuth = createAuth({
      pool: authPool,
      baseURL: opts.appUrl,
      secret: opts.authSecret,
      roles: roleSource(appPool),
    });
    const vendorAuth = createAuth({
      pool: authPool,
      baseURL: opts.vendorUrl,
      surface: "vendor",
      secret: opts.authSecret,
      roles: async () => [],
      allowAddress: async (ip) =>
        (await vendorPool!.query<{ ok: boolean }>(`select public.vendor_console_ip_allowed($1) as ok`, [ip])).rows[0].ok,
    });

    const key = () => randomUUID();

    const credentialRecords: {
      role: string;
      email: string;
      displayName: string;
      password: string;
      totpSecret: string | null;
      totpUri: string | null;
      branches: string[];
    }[] = [];

    const enrollTotp = async (
      targetAuth: Auth,
      baseUrl: string,
      basePath: string,
      email: string,
      password: string,
      ip: string,
    ) => {
      const client = new AuthSessionClient(targetAuth, baseUrl, basePath, ip);
      const signInRes = await client.post("/sign-in/email", { email, password });
      if (signInRes.status !== 200) throw new Error(`demo seed sign-in failed for ${email}: HTTP ${signInRes.status}`);
      const enRes = await client.post("/two-factor/enable", { password });
      if (enRes.status !== 200) throw new Error(`demo seed 2fa enable failed for ${email}: HTTP ${enRes.status}`);
      const totpUri = String(enRes.json.totpURI ?? "");
      const totpSecret = secretFromOtpAuthUri(totpUri);
      const verRes = await client.post("/two-factor/verify-totp", { code: totp(totpSecret) });
      if (verRes.status !== 200) throw new Error(`demo seed 2fa verify failed for ${email}: HTTP ${verRes.status}`);
      return { client, totpSecret, totpUri };
    };

    // Derive a concrete client IP guaranteed to fall inside vendorAllowlistCidr.
    const vendorIp = (
      await seedLockClient.query<{ ip: string }>(`select host($1::cidr) as ip`, [opts.vendorAllowlistCidr])
    ).rows[0].ip;
    const dbToday = (
      await seedLockClient.query<{ d: string }>(
        `select to_char(clock_timestamp() at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as d`,
      )
    ).rows[0].d;

    // 3. Bootstrap Platform Owner + Onboarding/Finance Vendor Staff (maker-checker) + complete
    //    synthetic Indonesian vendor_profile via real vendor writers.
    const vendorEmail = "vendor.owner@klinik-estetika.test";
    const vendorPassword = generateDemoPassword(vendorEmail);
    const vendorUser = await vendorAuth.createStaffAccount({
      email: vendorEmail,
      name: "Platform Owner Staging",
      password: vendorPassword,
    });
    const opClient = await ownerPool.connect();
    let vendorOwnerStaffId: string;
    let vendorOnboardingStaffId: string;
    let poSessionToken: string;
    let onbSessionToken: string;
    let onbUser: { id: string };
    const onbEmail = "vendor.onboarding@klinik-estetika.test";
    const onbPassword = generateDemoPassword(onbEmail);
    let vendorTotp: { client: AuthSessionClient; totpSecret: string; totpUri: string };
    let onbTotp: { client: AuthSessionClient; totpSecret: string; totpUri: string };
    try {
      vendorOwnerStaffId = await bootstrapVendor(
        opClient,
        vendorUser.id,
        "Platform Owner Staging",
        opts.vendorAllowlistCidr,
        "Staging Demo Bootstrap",
      );
      vendorTotp = await enrollTotp(vendorAuth, opts.vendorUrl, VENDOR_AUTH_BASE_PATH, vendorEmail, vendorPassword, vendorIp);
      const poCheck = await vendorAuth.checkSession(vendorTotp.client.headers(), { activity: false });
      if (poCheck.gate !== "ok") throw new Error(`vendor owner session gate unexpected: ${poCheck.gate}`);
      poSessionToken = poCheck.token;

      // Read REAL Better Auth verified second_factor_at from auth_session (never fabricated).
      const poMfaRow = await authPool.query<{ second_factor_at: Date | null }>(
        `select second_factor_at from public.auth_session where id = $1`,
        [poCheck.sessionId],
      );
      const poVerifiedMfaAt = poMfaRow.rows[0]?.second_factor_at;
      if (!poVerifiedMfaAt) {
        throw new Error("vendor owner session missing verified second_factor_at timestamp");
      }

      onbUser = await vendorAuth.createStaffAccount({
        email: onbEmail,
        name: "Tim Onboarding & Keuangan Staging",
        password: onbPassword,
      });
      vendorOnboardingStaffId = await createVendorStaff(
        opClient,
        { accountId: vendorUser.id, ip: vendorIp, mfaAt: poVerifiedMfaAt },
        onbUser.id,
        "Tim Onboarding & Keuangan Staging",
        ["onboarding", "vendor_finance"],
      );
      onbTotp = await enrollTotp(vendorAuth, opts.vendorUrl, VENDOR_AUTH_BASE_PATH, onbEmail, onbPassword, vendorIp);
      const onbCheck = await vendorAuth.checkSession(onbTotp.client.headers(), { activity: false });
      if (onbCheck.gate !== "ok") throw new Error(`vendor onboarding session gate unexpected: ${onbCheck.gate}`);
      onbSessionToken = onbCheck.token;

      await updateVendorProfile(
        opClient,
        { accountId: vendorUser.id, vendorRole: "platform_owner" },
        {
          legal_name: "PT KlinikMu Teknologi Sintetis",
          nib: "9999000012345",
          pse_number: "000999.01/DJAI.PSE/11/2026",
          npwp: "9999000012345678",
          meta_business_id: "999900001234567",
          website: "https://staging-vendor.klinikmu.test",
          privacy_url: "https://staging-vendor.klinikmu.test/privasi",
          support_email: "dukungan@klinik-estetika.test",
          support_phone: "+6281100000999",
          storageLocations: (["database", "object_storage", "backups", "logs", "error_tracking"] as const).map(
            (kind) => ({ kind, provider: "Biznet Gio", region: "Jakarta", country: "ID" }),
          ),
        },
        "Profil vendor sintetis staging",
      );
    } finally {
      opClient.release();
    }

    credentialRecords.push(
      {
        role: "platform_owner",
        email: vendorEmail,
        displayName: "Platform Owner Staging",
        password: vendorPassword,
        totpSecret: vendorTotp.totpSecret,
        totpUri: vendorTotp.totpUri,
        branches: ["*"],
      },
      {
        role: "vendor_onboarding",
        email: onbEmail,
        displayName: "Tim Onboarding & Keuangan Staging",
        password: onbPassword,
        totpSecret: onbTotp.totpSecret,
        totpUri: onbTotp.totpUri,
        branches: ["*"],
      },
    );

    const asVendorOnb = { token: onbSessionToken, ip: vendorIp };
    const asVendorPo = { token: poSessionToken, ip: vendorIp };

    // 4. Provision 1 clinic tenant + first branch (KMG) + first-owner invitation through the
    //    real vendor console provisioning writer (zero raw INSERTs into tenants_registry / tenants).
    const ownerEmail = `${ROLE_EMAIL_SLUG.owner}.demo@klinik-estetika.test`;
    const ownerPassword = generateDemoPassword(ownerEmail);
    const createdTenant = await createTenant(vendorPool, asVendorOnb, {
      legalName: "PT Klinik Estetika Demo Nusantara",
      sak: "emkm",
      branchCode: "KMG",
      branchName: "Klinik Estetika Kemang",
      timezone: "Asia/Jakarta",
      ownerName: ROLE_DISPLAY_NAMES.owner,
      ownerEmail,
    });
    if (!createdTenant.ok) {
      throw new Error(`demo seed createTenant failed: ${createdTenant.code} (${createdTenant.reason ?? "unknown"})`);
    }
    const tenantId = createdTenant.data.tenant_id;
    const b1 = createdTenant.data.branch_id;

    // Maker-checker approval of first-owner invitation by Platform Owner, then Owner acceptance.
    const approvedInvite = await approveOwnerInvite(vendorPool, asVendorPo, createdTenant.data.invitation_id);
    if (!approvedInvite.ok) {
      throw new Error(`demo seed approveOwnerInvite failed: ${approvedInvite.code} (${approvedInvite.reason ?? "unknown"})`);
    }
    const acceptedOwner = await acceptOwnerWithNewAccount(appPool, appAuth, approvedInvite.data.token, ownerPassword);
    if (!acceptedOwner || acceptedOwner.tenantId !== tenantId) {
      throw new Error("demo seed acceptOwnerWithNewAccount failed");
    }

    type Actor = {
      role: Role;
      email: string;
      displayName: string;
      accountId: string;
      staffId: string;
      branch?: string;
      branches: string[];
      totpEnrolled: boolean;
      sessionClient?: AuthSessionClient;
      totpSecret?: string;
    };

    const actors = {} as Record<Role, Actor>;
    let nextClientIpOctet = 10;
    const nextSyntheticIp = () => `203.0.113.${nextClientIpOctet++}`;

    const ownerTotp = await enrollTotp(appAuth, opts.appUrl, "/api/auth", ownerEmail, ownerPassword, nextSyntheticIp());
    credentialRecords.push({
      role: "owner",
      email: ownerEmail,
      displayName: ROLE_DISPLAY_NAMES.owner,
      password: ownerPassword,
      totpSecret: ownerTotp.totpSecret,
      totpUri: ownerTotp.totpUri,
      branches: ["*"],
    });
    const OWN: Actor = {
      role: "owner",
      email: ownerEmail,
      displayName: ROLE_DISPLAY_NAMES.owner,
      accountId: acceptedOwner.accountId,
      staffId: acceptedOwner.staffId,
      branches: [],
      totpEnrolled: true,
      sessionClient: ownerTotp.client,
      totpSecret: ownerTotp.totpSecret,
    };
    actors.owner = OWN;

    const as = async <R>(
      actor: Actor,
      fn: (db: pg.PoolClient) => Promise<R>,
      optsAs: { branchId?: string; session?: SessionBinding } = {},
    ): Promise<R> => {
      assertFenceAlive();
      const ctx = await resolveContext(appPool!, actor.accountId, {
        tenantId,
        actingRole: actor.role,
        activeBranchId: optsAs.branchId ?? actor.branch,
      });
      return withTenantContext(appPool!, { ...ctx, session: optsAs.session }, fn);
    };

    // Approve processor agreement so tenant enters onboarding cleanly through advanceTenant().
    const uploadAndApproveCompliance = async (uploader: Actor, obligationKey: string, branchId?: string) => {
      const uploaded = await as(
        uploader,
        (db) =>
          uploadEvidence(db, {
            obligationKey,
            fileName: `${obligationKey}-demo.pdf`,
            content: demoPdf(`Kepatuhan Sintetis: ${obligationKey} (${tenantId.slice(0, 8)})`),
            expertName: "Konsultan Kepatuhan Sintetis",
            documentDate: dbToday,
          }),
        { branchId },
      );
      await as(OWN, async (db) => {
        const itemId = (
          await db.query<{ item_id: string }>(`select item_id from evidence_files where id = $1`, [uploaded.fileId])
        ).rows[0].item_id;
        await decideEvidence(db, itemId, uploaded.fileId, "approved");
      });
    };

    await uploadAndApproveCompliance(OWN, "processor_agreement_signed");

    const enteredOnboarding = await advanceTenant(
      vendorPool,
      asVendorOnb,
      tenantId,
      "onboarding",
      "Mulai onboarding klinik staging demo",
    );
    if (!enteredOnboarding.ok) {
      throw new Error(`demo seed advanceTenant(onboarding) failed: ${enteredOnboarding.code} (${enteredOnboarding.reason ?? "unknown"})`);
    }

    // Create second branch (MNT) via real createBranch() writer (auto-seeds branch checklist items).
    const b2 = await as(OWN, (db) =>
      createBranch(db, { code: "MNT", name: "Klinik Estetika Menteng", timezone: "Asia/Jakarta" }),
    );

    const createActor = async (role: Role, branchIds: string[]): Promise<Actor> => {
      assertFenceAlive();
      const email = `${ROLE_EMAIL_SLUG[role]}.demo@klinik-estetika.test`;
      const displayName = ROLE_DISPLAY_NAMES[role];
      const password = generateDemoPassword(email);
      const user = await appAuth.createStaffAccount({ email, name: displayName, password });
      const { staffId } = await createMembership(ownerPool, {
        tenantId,
        accountId: user.id,
        displayName,
      });
      const c = await ownerPool.connect();
      try {
        const rid = await assignRole(c, { tenantId, staffId, role });
        if (!LEVEL2_ROLES.has(role)) {
          for (const bid of branchIds) {
            await assignBranch(c, { tenantId, staffRoleId: rid, branchId: bid });
          }
        }
      } finally {
        c.release();
      }
      let totpSecret: string | null = null;
      let totpUri: string | null = null;
      let sessionClient: AuthSessionClient | undefined;
      if (TOTP_ROLES.has(role)) {
        const enrolled = await enrollTotp(appAuth, opts.appUrl, "/api/auth", email, password, nextSyntheticIp());
        totpSecret = enrolled.totpSecret;
        totpUri = enrolled.totpUri;
        sessionClient = enrolled.client;
      }
      credentialRecords.push({
        role,
        email,
        displayName,
        password,
        totpSecret,
        totpUri,
        branches: LEVEL2_ROLES.has(role) ? ["*"] : branchIds,
      });
      const actor: Actor = {
        role,
        email,
        displayName,
        accountId: user.id,
        staffId,
        branch: LEVEL2_ROLES.has(role) ? undefined : branchIds[0],
        branches: LEVEL2_ROLES.has(role) ? [] : branchIds,
        totpEnrolled: totpSecret !== null,
        sessionClient,
        totpSecret: totpSecret ?? undefined,
      };
      actors[role] = actor;
      return actor;
    };

    // Remaining 15 clinic roles (total 16 exact ROLES).
    const AP = await createActor("admin_pusat", []);
    const MGR = await createActor("manager", [b1, b2]);
    const FH = await createActor("facility_head", [b1, b2]);
    const RO = await createActor("records_officer", [b1, b2]);
    const FO = await createActor("fo_cashier", [b1, b2]);
    const CS = await createActor("central_cs", []);
    const BC = await createActor("bc", [b1, b2]);
    const DOC = await createActor("doctor", [b1, b2]);
    const NUR = await createActor("nurse", [b1, b2]);
    const THR = await createActor("therapist", [b1, b2]);
    const PH = await createActor("pharmacist", [b1, b2]);
    const FIN = await createActor("finance", []);
    const MKT = await createActor("marketing", []);
    const PUR = await createActor("purchasing", []);
    const AU = await createActor("auditor", []);

    // Complete PR-59 onboarding checklist + clinical go-live compliance evidence, then
    // advance tenant from onboarding -> live through advanceTenant().
    for (const obl of CLINICAL_GO_LIVE_OBLIGATIONS) {
      const uploader = OWNER_OPERATIONS_OBLIGATIONS.has(obl) ? OWN : FH;
      await uploadAndApproveCompliance(uploader, obl, uploader === FH ? b1 : undefined);
    }
    const clRes = await checklist(vendorPool, asVendorOnb, tenantId);
    if (!clRes.ok) {
      throw new Error(`demo seed checklist read failed: ${clRes.code} (${clRes.reason ?? "unknown"})`);
    }
    for (const item of clRes.data.items) {
      if (item.status !== "open") continue;
      const isOptional = OPTIONAL_ITEMS.includes(item.item);
      const setRes = await setChecklistItem(vendorPool, asVendorOnb, tenantId, {
        branchId: item.branch_id,
        item: item.item,
        status: isOptional ? "not_applicable" : "done",
        note: isOptional
          ? "Integrasi eksternal dinonaktifkan pada staging sintetis"
          : "Selesai diverifikasi untuk staging demo",
        ownerId: null,
      });
      if (!setRes.ok) {
        throw new Error(`demo seed setChecklistItem(${item.item}) failed: ${setRes.code} (${setRes.reason ?? "unknown"})`);
      }
    }
    const wentLive = await advanceTenant(
      vendorPool,
      asVendorPo,
      tenantId,
      "live",
      "Aktifkan klinik staging demo siap beroperasi",
    );
    if (!wentLive.ok) {
      throw new Error(
        `demo seed advanceTenant(live) failed: ${wentLive.code} (${wentLive.reason ?? "unknown"}, blocker=${wentLive.blocker ?? "none"})`,
      );
    }

    // Mint a fresh doctor SessionBinding + StepUp proof for each clinical record signing.
    const mintFreshDoctorStepUp = async (): Promise<{ binding: SessionBinding; stepUp: StepUp }> => {
      const check = await appAuth.checkSession(DOC.sessionClient!.headers(), { activity: false });
      if (check.gate !== "ok") {
        throw new Error(`doctor demo session gate unexpected: ${check.gate}`);
      }
      const stepUp = await appAuth.stepUp(DOC.sessionClient!.headers(), totp(DOC.totpSecret!));
      if (!stepUp) throw new Error("failed to mint fresh Better Auth StepUp proof for demo doctor");
      return { binding: check.binding, stepUp };
    };

    // 5. Branch profiles, weekly hours, rooms, devices, clinical credentials (STR/SIP), and rosters.
    await as(OWN, (db) =>
      updateBranchProfile(db, b1, {
        address: "Jl. Kemang Raya No. 88, Jakarta Selatan",
        whatsapp_number: "+6281100001001",
        responsible_staff_id: FH.staffId,
      }),
    );
    await as(OWN, (db) =>
      updateBranchProfile(db, b2, {
        address: "Jl. HOS Cokroaminoto No. 42, Jakarta Pusat",
        whatsapp_number: "+6281100001002",
        responsible_staff_id: FH.staffId,
      }),
    );

    const fullWeekHours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "08:00", closes: "21:00" }));
    await as(OWN, (db) => setHours(db, b1, fullWeekHours));
    await as(OWN, (db) => setHours(db, b2, fullWeekHours));

    const r1Consult = await as(OWN, (db) => upsertRoom(db, b1, { name: "Ruang Konsultasi Kemang 1", kind: "consultation" }));
    const r1TreatA = await as(OWN, (db) => upsertRoom(db, b1, { name: "Ruang Tindakan Kemang A", kind: "treatment" }));
    const r1TreatB = await as(OWN, (db) => upsertRoom(db, b1, { name: "Ruang Tindakan Kemang B", kind: "treatment" }));
    const r2TreatA = await as(OWN, (db) => upsertRoom(db, b2, { name: "Ruang Tindakan Menteng A", kind: "treatment" }));
    const devLaser1 = await as(OWN, (db) => upsertDevice(db, b1, { type: "laser", label: "Pico Laser Kemang 01" }));
    await as(OWN, (db) => upsertDevice(db, b2, { type: "laser", label: "Pico Laser Menteng 01" }));

    // Real two-person credential record (Owner) + verify (Facility Head) for doctor, nurse, therapist, pharmacist.
    const verifyCred = async (
      staffId: string,
      profession: "dokter" | "perawat" | "apoteker" | "tenaga_kesehatan_lain",
      permitKind: "sip" | "sipp" | "sipa",
      prefix: string,
      branches: string[],
    ) => {
      const str = await as(OWN, (db) =>
        recordCredential(db, key(), staffId, {
          kind: "str",
          number: `STR-${prefix}-2026`,
          issuer: "Konsil Kesehatan Indonesia",
          profession,
          validFrom: "2024-01-01",
          expiresOn: null,
        }),
      );
      await as(FH, (db) => decideCredential(db, key(), str.credentialId, true, null));
      for (let i = 0; i < branches.length; i++) {
        const permit = await as(OWN, (db) =>
          recordCredential(db, key(), staffId, {
            kind: permitKind,
            number: `${permitKind.toUpperCase()}-${prefix}-${i + 1}-2026`,
            issuer: "Dinas Kesehatan DKI Jakarta",
            profession,
            branchId: branches[i],
            validFrom: "2024-01-01",
            expiresOn: addDays(dbToday, 365),
          }),
        );
        await as(FH, (db) => decideCredential(db, key(), permit.credentialId, true, null), {
          branchId: branches[i],
        });
      }
    };
    await verifyCred(DOC.staffId, "dokter", "sip", "DOC", [b1, b2]);
    await verifyCred(NUR.staffId, "perawat", "sipp", "NUR", [b1, b2]);
    await verifyCred(THR.staffId, "tenaga_kesehatan_lain", "sip", "THR", [b1, b2]);
    await verifyCred(PH.staffId, "apoteker", "sipa", "PH", [b1, b2]);

    // Weekly rosters (current week + next 2 weeks), split non-overlapping between KMG (08:00-14:30) and MNT (15:00-20:30).
    const baseMon = mondayOfWeek(dbToday);
    for (const [branchId, starts, ends] of [
      [b1, "08:00", "14:30"],
      [b2, "15:00", "20:30"],
    ] as const) {
      for (const weekOffset of [0, 7, 14]) {
        const weekStart = addDays(baseMon, weekOffset);
        const rows: ShiftRow[] = [];
        for (let d = 0; d < 7; d++) {
          const date = addDays(weekStart, d);
          if (date < dbToday) continue;
          for (const staffId of [DOC.staffId, NUR.staffId, THR.staffId]) {
            rows.push({ staffId, date, starts, ends, kind: "work" });
          }
        }
        if (rows.length > 0) {
          await as(MGR, (db) => setWeek(db, branchId, weekStart, [DOC.staffId, NUR.staffId, THR.staffId], rows), {
            branchId,
          });
        }
      }
    }

    // 6. Catalog: 12 services, 10 products, 3 packages via publish() + Facility Head clinical approval.
    const publishApproved = async (
      kind: "service" | "product" | "package",
      code: string,
      fields: Parameters<typeof publish>[2],
    ) => {
      const pub = await as(OWN, (db) => publish(db, { kind, code }, fields, "Katalog demo staging"));
      if (pub.approvalId) {
        await as(FH, (db) => decideApproval(db, pub.approvalId!, true, "Disetujui untuk staging demo"));
      }
      if (pub.materialsApprovalId) {
        await as(PH, (db) => decideApproval(db, pub.materialsApprovalId!, true, "Formula bahan disetujui"));
      }
      return pub;
    };

    const serviceSpecs = [
      { code: "SVC-FAC-GLOW", name: "Facial Glow Signature", price: 650_000, cat: "facial", prep: 10, tx: 45, buf: 10, elig: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }, { role: "therapist", mode: "performs" }] },
      { code: "SVC-FAC-HYDRA", name: "Hydra Deep Cleansing", price: 750_000, cat: "facial", prep: 10, tx: 45, buf: 10, elig: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }, { role: "therapist", mode: "performs" }] },
      { code: "SVC-FAC-ACNE", name: "Acne Calming Facial", price: 550_000, cat: "facial", prep: 10, tx: 40, buf: 10, elig: [{ role: "nurse", mode: "performs" }, { role: "therapist", mode: "performs" }] },
      { code: "SVC-PEEL-BRIGHT", name: "Chemical Peeling Brightening", price: 600_000, cat: "peeling_chemical", prep: 10, tx: 30, buf: 10, elig: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "supervised" }] },
      { code: "SVC-PEEL-ACNE", name: "Salicylic Acne Peeling", price: 500_000, cat: "peeling_chemical", prep: 10, tx: 25, buf: 10, elig: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "supervised" }] },
      { code: "SVC-LASER-PICO", name: "Pico Laser Rejuvenation", price: 1_850_000, cat: "laser_non_ablative", prep: 15, tx: 30, buf: 15, dp: 300_000, elig: [{ role: "doctor", mode: "performs" }] },
      { code: "SVC-LASER-TONE", name: "Laser Toning Pigment", price: 1_500_000, cat: "laser_non_ablative", prep: 15, tx: 30, buf: 15, elig: [{ role: "doctor", mode: "performs" }] },
      { code: "SVC-INJ-BOOSTER", name: "Skin Booster Hyaluronic", price: 2_400_000, cat: "injection", prep: 15, tx: 30, buf: 15, elig: [{ role: "doctor", mode: "performs" }] },
      { code: "SVC-INJ-FILLER", name: "Dermal Filler 1ml", price: 3_500_000, cat: "filler", prep: 15, tx: 35, buf: 15, elig: [{ role: "doctor", mode: "performs" }] },
      { code: "SVC-INJ-BOTOX", name: "Anti-Wrinkle Injection", price: 2_200_000, cat: "toxin", prep: 15, tx: 25, buf: 15, elig: [{ role: "doctor", mode: "performs" }] },
      { code: "SVC-RF-LIFT", name: "Radiofrequency Face Lift", price: 1_200_000, cat: "facial", prep: 10, tx: 40, buf: 10, elig: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }, { role: "therapist", mode: "performs" }] },
      { code: "SVC-KONSUL", name: "Konsultasi Dokter Estetika", price: 250_000, cat: "consultation", prep: 5, tx: 20, buf: 5, elig: [{ role: "doctor", mode: "performs" }] },
    ];

    const services = new Map<string, { itemId: string; versionId: string; price: number }>();
    for (const s of serviceSpecs) {
      const pub = await publishApproved("service", s.code, {
        name: s.name,
        tax_category: "exempt_medical",
        tax_basis: "Jasa medis estetika",
        normal_price: s.price,
        category: s.cat,
        prep_min: s.prep,
        treatment_min: s.tx,
        buffer_min: s.buf,
        booking_dp_enabled: Boolean(s.dp),
        booking_dp_amount: s.dp ?? null,
        commission_scope: ["closing_bc", "guiding_bc", "performer"],
        indications: `Indikasi klinis sintetis untuk ${s.name}.`,
        consent_template: `Templat persetujuan tindakan ${s.name}.`,
        delegation: s.elig.every((e) => e.role === "doctor") ? "Dokter" : "Dokter / Perawat / Terapis terlatih",
        aftercare_text: "Gunakan tabir surya SPF 30+ dan hindari paparan matahari langsung 48 jam.",
        eligibility: s.elig,
      });
      services.set(s.code, { itemId: pub.itemId, versionId: pub.versionId, price: s.price });
    }

    const allServiceIds = [...services.values()].map((s) => s.itemId);
    await as(OWN, (db) => setServices(db, b1, allServiceIds));
    await as(OWN, (db) => setServices(db, b2, allServiceIds));

    const productSpecs = [
      { code: "PRD-SUN-50", name: "Sunscreen Fluid SPF 50", price: 185_000, cost: 90_000, unit: "tube" },
      { code: "PRD-SERUM-C", name: "Vitamin C Brightening Serum", price: 275_000, cost: 130_000, unit: "botol" },
      { code: "PRD-NIACIN", name: "Niacinamide Barrier Essence", price: 240_000, cost: 110_000, unit: "botol" },
      { code: "PRD-WASH-G", name: "Gentle Amino Facial Wash", price: 145_000, cost: 65_000, unit: "botol" },
      { code: "PRD-MOIST-C", name: "Ceramide Soothing Cream", price: 220_000, cost: 105_000, unit: "pot" },
      { code: "PRD-ACNE-GEL", name: "Spot Clear BHA Gel", price: 165_000, cost: 75_000, unit: "tube" },
      { code: "PRD-RET-NIGHT", name: "Retinol Renewal Night Cream", price: 310_000, cost: 150_000, unit: "pot" },
      { code: "PRD-MASK-HYD", name: "Post-Laser Recovery Mask", price: 95_000, cost: 40_000, unit: "pcs" },
      { code: "PRD-TONER-P", name: "PHA Gentle Exfoliating Toner", price: 175_000, cost: 80_000, unit: "botol" },
      { code: "PRD-LIP-BALM", name: "Peptide Repair Lip Balm", price: 115_000, cost: 50_000, unit: "tube" },
    ];

    const products = new Map<string, { itemId: string; versionId: string; price: number; cost: number; unit: string }>();
    for (const p of productSpecs) {
      const pub = await publishApproved("product", p.code, {
        name: p.name,
        tax_category: "taxable_goods",
        tax_basis: "Produk perawatan kulit",
        normal_price: p.price,
        commission_scope: ["closing_bc", "guiding_bc"],
      });
      products.set(p.code, { itemId: pub.itemId, versionId: pub.versionId, price: p.price, cost: p.cost, unit: p.unit });
    }

    const svcFacial = services.get("SVC-FAC-GLOW")!;
    const svcPeel = services.get("SVC-PEEL-BRIGHT")!;
    const svcLaser = services.get("SVC-LASER-PICO")!;
    const svcFiller = services.get("SVC-INJ-FILLER")!;
    const svcHydra = services.get("SVC-FAC-HYDRA")!;
    const prdSun = products.get("PRD-SUN-50")!;
    const prdSerum = products.get("PRD-SERUM-C")!;
    const prdWash = products.get("PRD-WASH-G")!;

    const pkgGlow = await publishApproved("package", "PKG-GLOW-5", {
      name: "Paket Facial Glow 5 Sesi",
      tax_category: "exempt_medical",
      tax_basis: "Paket layanan estetika",
      normal_price: 2_750_000,
      installments_allowed: true,
      validity_days: 180,
    });
    await as(OWN, (db) => setPackageContents(db, key(), pkgGlow.versionId, [{ serviceItemId: svcFacial.itemId, count: 5 }]));

    const pkgLaser = await publishApproved("package", "PKG-LASER-3", {
      name: "Paket Pico Laser 3 Sesi",
      tax_category: "exempt_medical",
      tax_basis: "Paket layanan laser",
      normal_price: 4_800_000,
      installments_allowed: true,
      validity_days: 180,
    });
    await as(OWN, (db) => setPackageContents(db, key(), pkgLaser.versionId, [{ serviceItemId: svcLaser.itemId, count: 3 }]));

    const pkgPeel = await publishApproved("package", "PKG-PEEL-4", {
      name: "Paket Brightening Peeling 4 Sesi",
      tax_category: "exempt_medical",
      tax_basis: "Paket layanan peeling",
      normal_price: 2_000_000,
      installments_allowed: true,
      validity_days: 120,
    });
    await as(OWN, (db) => setPackageContents(db, key(), pkgPeel.versionId, [{ serviceItemId: svcPeel.itemId, count: 4 }]));

    // 7. Inventory, Depots, Suppliers, POs, Goods Receipts, Supplier Payable, Depot Transfer & Stock Count.
    const depotKmgMain = (await as(PH, (db) => createDepot(db, key(), { branchId: b1, name: "Gudang Apotek Kemang", kind: "apotek" }))).depotId;
    const depotKmgRoom = (await as(PH, (db) => createDepot(db, key(), { branchId: b1, name: "Depot Ruang Tindakan Kemang", kind: "ruang", roomId: r1TreatA }))).depotId;
    await as(PH, (db) => createDepot(db, key(), { branchId: b2, name: "Gudang Apotek Menteng", kind: "apotek" }), { branchId: b2 });

    const stockItemIds = new Map<string, string>();
    for (const [code, prd] of products.entries()) {
      const si = await as(PH, (db) =>
        saveItem(db, key(), null, {
          catalogItemId: prd.itemId,
          unit: prd.unit,
          storage: "ruang",
          highValue: prd.price >= 250_000,
          active: true,
        }),
      );
      stockItemIds.set(code, si.itemId);
    }

    const stSun = stockItemIds.get("PRD-SUN-50")!;
    const stSerum = stockItemIds.get("PRD-SERUM-C")!;
    const stWash = stockItemIds.get("PRD-WASH-G")!;
    const stMask = stockItemIds.get("PRD-MASK-HYD")!;

    await as(PUR, (db) => setLevel(db, key(), b1, stSun, "10", "30"));
    await as(PUR, (db) => setLevel(db, key(), b1, stSerum, "8", "24"));
    await as(PUR, (db) => setLevel(db, key(), b1, stWash, "10", "25"));
    await as(PUR, (db) => setLevel(db, key(), b1, stMask, "25", "50"));
    await as(PUR, (db) => setLevel(db, key(), b2, stSun, "10", "25"));

    const supDerm = (
      await as(PUR, (db) =>
        saveSupplier(db, key(), null, {
          name: "PT Derma Nusantara Distribusi",
          contactName: "Hadi Kusuma",
          phone: "+6281100009001",
          email: "order@derma-sintetis.test",
          address: "Kawasan Industri Cikarang",
          paymentTermsDays: 30,
          active: true,
        }),
      )
    ).supplierId;

    const expFuture = addDays(dbToday, 365);
    const expNear = addDays(dbToday, 20);
    const sunBatch = await as(PH, (db) =>
      receiveCosted(db, key(), b1, {
        itemId: stSun,
        batchNo: "SUN-2026-01",
        expiry: expFuture,
        quantity: "30",
        reason: "stok_awal",
        unitCost: prdSun.cost,
      }),
    );
    await as(PH, (db) =>
      receiveCosted(db, key(), b1, {
        itemId: stSerum,
        batchNo: "SRM-2026-01",
        expiry: expFuture,
        quantity: "24",
        reason: "stok_awal",
        unitCost: prdSerum.cost,
      }),
    );
    await as(PH, (db) =>
      receiveCosted(db, key(), b1, {
        itemId: stWash,
        batchNo: "WSH-2026-01",
        expiry: expNear,
        quantity: "20",
        reason: "stok_awal",
        unitCost: prdWash.cost,
      }),
    );
    await as(PH, (db) =>
      receiveCosted(db, key(), b1, {
        itemId: stMask,
        batchNo: "MSK-2026-01",
        expiry: expFuture,
        quantity: "6",
        reason: "stok_awal",
        unitCost: 40_000,
      }),
    );
    await as(
      PH,
      (db) =>
        receiveCosted(db, key(), b2, {
          itemId: stSun,
          batchNo: "SUN-MNT-01",
          expiry: expFuture,
          quantity: "8",
          reason: "stok_awal",
          unitCost: prdSun.cost,
        }),
      { branchId: b2 },
    );

    const defaultDepotKmg = (await as(PH, (db) => listDepots(db, b1))).find((d) => d.is_default)?.id ?? depotKmgMain;
    await as(PH, (db) =>
      transferBetweenDepots(db, key(), {
        fromDepotId: defaultDepotKmg,
        toDepotId: depotKmgRoom,
        lines: [{ batchId: sunBatch.batchId, quantity: "4" }],
      }),
    );

    const poReceived = await as(PUR, (db) =>
      savePurchaseOrder(db, key(), null, {
        supplierId: supDerm,
        branchId: b1,
        expectedDate: dbToday,
        note: "Restock rutin Kemang",
        lines: [{ itemId: stSun, quantity: "10", unitPrice: prdSun.cost }],
      }),
    );
    await as(PUR, (db) => sendPurchaseOrder(db, key(), poReceived.poId));
    const gr = await as(PH, (db) =>
      receiveGoods(db, key(), b1, {
        supplierId: supDerm,
        poId: poReceived.poId,
        deliveryNote: "SJ-DEMO-001",
        lines: [{ itemId: stSun, batchNo: "SUN-2026-02", expiry: expFuture, quantity: "10", unitCost: prdSun.cost }],
      }),
    );
    const grSupplierReceiptId = await as(PUR, async (db) => {
      const r = await db.query<{ id: string }>(
        `select id from supplier_receipts where source_kind = 'goods_receipt' and source_id = $1 limit 1`,
        [gr.receiptId],
      );
      return r.rows[0].id;
    });
    await as(PUR, (db) =>
      recordInvoice(db, key(), b1, {
        supplierId: supDerm,
        number: "INV-SUP-DEMO-001",
        invoiceDate: dbToday,
        dueDate: addDays(dbToday, 7),
        lines: [{ receiptId: grSupplierReceiptId, amount: 10 * prdSun.cost }],
      }),
    );

    const poOpen = await as(PUR, (db) =>
      savePurchaseOrder(db, key(), null, {
        supplierId: supDerm,
        branchId: b1,
        expectedDate: addDays(dbToday, 5),
        note: "Pengadaan masker pasca-laser",
        lines: [{ itemId: stMask, quantity: "40", unitPrice: 40_000 }],
      }),
    );
    await as(PUR, (db) => sendPurchaseOrder(db, key(), poOpen.poId));

    const cnt = await as(PH, (db) => startCount(db, key(), false, [stWash]));
    const countLineId = await as(PH, async (db) => {
      const r = await db.query<{ id: string }>(
        `select id from stock_count_lines where count_id = $1 limit 1`,
        [cnt.countId],
      );
      return r.rows[0].id;
    });
    await as(PH, (db) => recordCount(db, key(), cnt.countId, countLineId, "19"));
    await as(PH, (db) => submitCount(db, key(), cnt.countId, "Selisih 1 botol uji sampel demo"));

    // 8. Register 30 synthetic patients through registerPatient() + sealIdentity(), plus marketing consent.
    const marketingConsentText = await as(OWN, (db) =>
      publishConsentText(db, {
        purpose: "marketing_wa",
        body: "Saya menyetujui menerima informasi promo dan pengingat perawatan sintetis dari Klinik Estetika Demo.",
      }),
    );

    const patientIds: string[] = [];
    for (let i = 0; i < SYNTHETIC_PATIENTS.length; i++) {
      const sp = SYNTHETIC_PATIENTS[i];
      const branchId = i < 20 ? b1 : b2;
      const syntheticNik = `999901${String(1000000001 + i).padStart(10, "0")}`;
      const syntheticPhone = `+628110000${String(2001 + i).padStart(4, "0")}`;
      const fields: RegistrationFields = {
        full_name: sp.name,
        birth_date: sp.birthDate,
        sex: sp.sex,
        phone: syntheticPhone,
        identity_type: "nik",
        religion: "islam",
        occupation: sp.occupation,
        education: sp.minor ? "smp" : "s1",
        marital_status: sp.marital,
        address: branchId === b1 ? `Jl. Kemang Timur No. ${10 + i}, Jakarta Selatan` : `Jl. Menteng Dalam No. ${10 + i}, Jakarta Pusat`,
        branch_id: branchId,
        guardian: sp.minor
          ? { name: `Ibu ${sp.name.split(" ")[0]}`, relation: "ibu", phone: `+628110000${String(8001 + i).padStart(4, "0")}` }
          : null,
      };
      const pid = await as(
        FO,
        async (db) => {
          const sealed = await sealIdentity(db, tenantId, "nik", syntheticNik);
          const reg = await registerPatient(db, fields, { enc: sealed.enc, bidx: sealed.bidx }, "new");
          if (!reg.ok) throw new Error(`patient_register refused for ${sp.name}: ${reg.code}`);
          return reg.patientId;
        },
        { branchId },
      );
      patientIds.push(pid);
      if (i % 2 === 0) {
        await as(
          FO,
          (db) =>
            grantConsent(db, key(), {
              patientId: pid,
              purpose: "marketing_wa",
              textId: marketingConsentText.id,
              channel: "in_person",
            }),
          { branchId },
        );
      }
    }

    // 9. Commission rules (activated by Owner) & staff targets for current month.
    const ruleClosing = await as(FIN, (db) =>
      createRule(db, key(), {
        contributionType: "closing_bc",
        name: "Komisi Closing BC 5%",
        kind: "percent",
        basisPoints: 500,
      }),
    );
    await as(OWN, (db) => decideRuleVersion(db, ruleClosing.versionId, "activate"));

    const rulePerformer = await as(FIN, (db) =>
      createRule(db, key(), {
        contributionType: "performer",
        name: "Jasa Tindakan Rp75.000",
        kind: "fixed",
        fixedAmount: 75_000,
      }),
    );
    await as(OWN, (db) => decideRuleVersion(db, rulePerformer.versionId, "activate"));

    const currentMonth = dbToday.slice(0, 7);
    await as(OWN, (db) => setStaffTarget(db, key(), BC.staffId, currentMonth, { closingValueTarget: 25_000_000, plansTarget: 15 }));

    // Helper: full clinical flow through real writers (walkIn -> intake -> exam -> plan -> fresh StepUp sign -> consent).
    const runClinicalVisit = async (optsV: {
      patientId: string;
      branchId: string;
      versions: string[];
      complaint: string;
      sign?: boolean;
      consent?: boolean;
      assignBc?: boolean;
    }) => {
      const { visitId } = await as(FO, (db) => walkIn(db, key(), optsV.patientId, optsV.branchId), { branchId: optsV.branchId });
      const { intakeId } = await as(BC, (db) => openIntake(db, key(), visitId), { branchId: optsV.branchId });
      await as(
        BC,
        (db) =>
          saveIntake(db, key(), intakeId, {
            complaint: optsV.complaint,
            facts: [{ kind: "allergy", value: "Tidak ada riwayat alergi obat" }],
            observation: { chips: ["kombinasi"], note: "Kondisi kulit stabil, sintetis demo" },
          }),
        { branchId: optsV.branchId },
      );
      await as(BC, (db) => sendIntake(db, key(), intakeId), { branchId: optsV.branchId });

      if (optsV.versions.length === 0) {
        return { visitId, examId: null as string | null, planId: null as string | null, planItemIds: [] as string[] };
      }

      const { examId } = await as(DOC, (db) => openExam(db, key(), visitId), { branchId: optsV.branchId });
      const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Rencana Perawatan Demo", "Evaluasi kulit sintetis"), {
        branchId: optsV.branchId,
      });
      const planItemIds: string[] = [];
      for (const ver of optsV.versions) {
        const pi = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: ver, qty: 1 }), {
          branchId: optsV.branchId,
        });
        planItemIds.push(pi.itemId);
      }
      if (optsV.assignBc) {
        await as(BC, (db) => assignGuidingBc(db, key(), planId, BC.staffId, "BC pendamping utama"), { branchId: optsV.branchId });
      }
      if (optsV.sign !== false) {
        const fresh = await mintFreshDoctorStepUp();
        await as(DOC, (db) => signRecord(db, key(), examId, fresh.stepUp), {
          branchId: optsV.branchId,
          session: fresh.binding,
        });
      }
      if (optsV.consent !== false) {
        const ct = await as(DOC, (db) => consentText(db, visitId, planId), { branchId: optsV.branchId });
        await as(
          DOC,
          (db) =>
            captureConsent(db, key(), {
              visitId,
              planId,
              signer: "patient",
              expectedHash: ct.content_hash,
              signature: demoPng(),
            }),
          { branchId: optsV.branchId },
        );
      }
      return { visitId, examId, planId, planItemIds };
    };

    // 10. Operational Visits, Payments, Packages, Balance, Receivables, Dispensing, Surveys, Expenses.
    let visitsCount = 0;

    await as(MKT, (db) =>
      createPromoCode(db, key(), "GLOWDEMO10", 50, {
        validFrom: addDays(dbToday, -7),
        validTo: addDays(dbToday, 30),
        discountKind: "percent",
        discountValue: 10,
        maxDiscount: 100_000,
        itemIds: [svcFacial.itemId, svcHydra.itemId],
      }),
    );

    // Visit 1 (EDC payment + promo code + product linked via selectionItemId + treatment + dispensing + close + survey).
    const v1 = await runClinicalVisit({
      patientId: patientIds[0],
      branchId: b1,
      versions: [svcFacial.versionId],
      complaint: "Kulit kusam dan butuh hidrasi ringan",
      assignBc: true,
    });
    visitsCount++;
    const sel1 = await as(BC, (db) =>
      confirmSelection(db, key(), v1.visitId, {
        items: [
          { planItemId: v1.planItemIds[0] },
          { catalogVersionId: prdSun.versionId, quantity: "1" },
        ],
        guidingBcId: BC.staffId,
        closingBcId: BC.staffId,
      }),
    );
    const v1SelProdId = await as(PH, async (db) => {
      const r = await db.query<{ id: string }>(
        `select id from selection_items where selection_id = $1 and catalog_version_id = $2 limit 1`,
        [sel1.selectionId, prdSun.versionId],
      );
      return r.rows[0].id;
    });
    const inv1 = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: patientIds[0], visitId: v1.visitId }));
    const iss1 = await as(FO, (db) =>
      issueKasirInvoice(db, key(), inv1.invoiceId, [
        { itemId: svcFacial.itemId, quantity: 1, promoCode: "GLOWDEMO10" },
        { itemId: prdSun.itemId, quantity: 1, selectionItemId: v1SelProdId },
      ]),
    );
    await as(FO, (db) =>
      receivePayment(db, key(), inv1.invoiceId, [
        { method: "edc", amount: iss1.total, details: { card_type: "debit", bank: "BCA", trace: "100101", approval_code: "DM01A1" } },
      ]),
    );
    await as(BC, (db) => attributeSale(db, key(), inv1.invoiceId, { closingBcId: BC.staffId, guidingBcId: BC.staffId }));
    const ex1 = await as(NUR, (db) =>
      startTreatment(db, key(), v1.visitId, {
        planItemId: v1.planItemIds[0],
        performerId: NUR.staffId,
        roomId: r1TreatA,
        identityConfirmed: true,
      }),
    );
    await as(NUR, (db) => finishTreatment(db, key(), ex1.executionId, { outcome: "completed" }));
    const v1DispId = await as(PH, async (db) => {
      const r = await db.query<{ id: string }>(`select id from dispensings where visit_id = $1 limit 1`, [v1.visitId]);
      return r.rows[0].id;
    });
    await as(PH, (db) => prepareDispensing(db, key(), v1DispId, defaultDepotKmg));
    const allChecks = Object.fromEntries(CHECKS.map((c) => [c, true])) as Record<(typeof CHECKS)[number], boolean>;
    await as(PH, (db) => handOver(db, key(), v1DispId, { checks: allChecks }));
    await as(FO, (db) => closeVisit(db, key(), v1.visitId));
    await as(CS, (db) => recordSurvey(db, key(), { visitId: v1.visitId, score: 5 }));

    // Visit 2 (Cash payment + Laser by Doctor + close + survey).
    const v2 = await runClinicalVisit({
      patientId: patientIds[1],
      branchId: b1,
      versions: [svcLaser.versionId],
      complaint: "Flek hitam pipi kanan dan kiri",
      assignBc: true,
    });
    visitsCount++;
    await as(BC, (db) =>
      confirmSelection(db, key(), v2.visitId, {
        items: [{ planItemId: v2.planItemIds[0] }],
        guidingBcId: BC.staffId,
        closingBcId: BC.staffId,
      }),
    );
    const inv2 = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: patientIds[1], visitId: v2.visitId }));
    const iss2 = await as(FO, (db) => issueKasirInvoice(db, key(), inv2.invoiceId, [{ itemId: svcLaser.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), inv2.invoiceId, [{ method: "cash", amount: iss2.total, cashTendered: iss2.total }]));
    await as(BC, (db) => attributeSale(db, key(), inv2.invoiceId, { closingBcId: BC.staffId, guidingBcId: BC.staffId }));
    const ex2 = await as(DOC, (db) =>
      startTreatment(db, key(), v2.visitId, {
        planItemId: v2.planItemIds[0],
        performerId: DOC.staffId,
        roomId: r1TreatB,
        identityConfirmed: true,
      }),
    );
    await as(DOC, (db) => finishTreatment(db, key(), ex2.executionId, { outcome: "completed" }));
    await as(FO, (db) => closeVisit(db, key(), v2.visitId));
    await as(CS, (db) => recordSurvey(db, key(), { visitId: v2.visitId, score: 5 }));

    // Visit 3 (Transfer payment + Hydra Facial performed by Therapist + close + survey).
    const v3 = await runClinicalVisit({
      patientId: patientIds[2],
      branchId: b1,
      versions: [svcHydra.versionId],
      complaint: "Bekas jerawat ringan di area dagu",
      assignBc: true,
    });
    visitsCount++;
    await as(BC, (db) =>
      confirmSelection(db, key(), v3.visitId, {
        items: [{ planItemId: v3.planItemIds[0] }],
        guidingBcId: BC.staffId,
        closingBcId: BC.staffId,
      }),
    );
    const inv3 = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: patientIds[2], visitId: v3.visitId }));
    const iss3 = await as(FO, (db) => issueKasirInvoice(db, key(), inv3.invoiceId, [{ itemId: svcHydra.itemId, quantity: 1 }]));
    await as(FO, (db) =>
      receivePayment(db, key(), inv3.invoiceId, [
        { method: "transfer", amount: iss3.total, details: { bank: "Mandiri", reference: "TRF-DEMO-003" } },
      ]),
    );
    const ex3 = await as(THR, (db) =>
      startTreatment(db, key(), v3.visitId, {
        planItemId: v3.planItemIds[0],
        performerId: THR.staffId,
        roomId: r1TreatA,
        identityConfirmed: true,
      }),
    );
    await as(THR, (db) => finishTreatment(db, key(), ex3.executionId, { outcome: "completed" }));
    await as(FO, (db) => closeVisit(db, key(), v3.visitId));
    await as(CS, (db) => recordSurvey(db, key(), { visitId: v3.visitId, score: 4 }));

    // Visit 4 (Addition performed before billing -> Receivable -> Collected in cash).
    const v4 = await runClinicalVisit({
      patientId: patientIds[3],
      branchId: b1,
      versions: [svcFacial.versionId],
      complaint: "Perawatan rutin bulanan + evaluasi garis senyum",
    });
    visitsCount++;
    await as(BC, (db) => confirmSelection(db, key(), v4.visitId, { items: [{ planItemId: v4.planItemIds[0] }] }));
    const inv4 = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: patientIds[3], visitId: v4.visitId }));
    await as(FO, (db) => issueKasirInvoice(db, key(), inv4.invoiceId, [{ itemId: svcFacial.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), inv4.invoiceId, [{ method: "cash", amount: svcFacial.price, cashTendered: svcFacial.price }]));
    const ex4a = await as(NUR, (db) =>
      startTreatment(db, key(), v4.visitId, { planItemId: v4.planItemIds[0], performerId: NUR.staffId, roomId: r1TreatA, identityConfirmed: true }),
    );
    await as(NUR, (db) => finishTreatment(db, key(), ex4a.executionId, { outcome: "completed" }));
    const addReq4 = await as(NUR, (db) =>
      createRequest(db, key(), v4.visitId, {
        kind: "addition",
        planId: v4.planId!,
        catalogVersionId: svcFiller.versionId,
        stage: 1,
        qty: 1,
        reason: "Tambahan filler garis senyum atas persetujuan pasien",
      }),
    );
    const addItem4 = ((await as(DOC, (db) => decideRequest(db, key(), addReq4.requestId, true, null))) as { item_id: string }).item_id;
    const ct4 = await as(DOC, (db) => consentText(db, v4.visitId, v4.planId!));
    await as(DOC, (db) =>
      captureConsent(db, key(), { visitId: v4.visitId, planId: v4.planId!, signer: "patient", expectedHash: ct4.content_hash, signature: demoPng() }),
    );
    await as(FO, (db) => releaseAddition(db, key(), addItem4, FO.staffId));
    const ex4b = await as(DOC, (db) =>
      startTreatment(db, key(), v4.visitId, { planItemId: addItem4, performerId: DOC.staffId, roomId: r1TreatB, identityConfirmed: true }),
    );
    await as(DOC, (db) => finishTreatment(db, key(), ex4b.executionId, { outcome: "completed" }));
    const inv4Add = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: patientIds[3], visitId: v4.visitId }));
    await as(FO, (db) => issueKasirInvoice(db, key(), inv4Add.invoiceId, [{ itemId: svcFiller.itemId, quantity: 1, planItemId: addItem4 }]));
    const rec4 = await as(FO, (db) => convertToReceivable(db, key(), v4.visitId));
    await as(FO, (db) => collectReceivable(db, key(), rec4.receivable_id, { method: "cash", amount: svcFiller.price, cashTendered: svcFiller.price }));
    await as(FO, (db) => closeVisit(db, key(), v4.visitId));

    // Visit 5 (Open Receivable — converted and left open so Piutang / Kewajiban has active balance).
    const v5 = await runClinicalVisit({
      patientId: patientIds[4],
      branchId: b1,
      versions: [svcHydra.versionId],
      complaint: "Pori-pori besar dan kulit berminyak",
    });
    visitsCount++;
    await as(BC, (db) => confirmSelection(db, key(), v5.visitId, { items: [{ planItemId: v5.planItemIds[0] }] }));
    const inv5 = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: patientIds[4], visitId: v5.visitId }));
    await as(FO, (db) => issueKasirInvoice(db, key(), inv5.invoiceId, [{ itemId: svcHydra.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), inv5.invoiceId, [{ method: "cash", amount: svcHydra.price, cashTendered: svcHydra.price }]));
    const ex5a = await as(THR, (db) =>
      startTreatment(db, key(), v5.visitId, { planItemId: v5.planItemIds[0], performerId: THR.staffId, roomId: r1TreatA, identityConfirmed: true }),
    );
    await as(THR, (db) => finishTreatment(db, key(), ex5a.executionId, { outcome: "completed" }));
    const addReq5 = await as(NUR, (db) =>
      createRequest(db, key(), v5.visitId, {
        kind: "addition",
        planId: v5.planId!,
        catalogVersionId: svcPeel.versionId,
        stage: 1,
        qty: 1,
        reason: "Tambahan peeling ringan pasca hydra",
      }),
    );
    const addItem5 = ((await as(DOC, (db) => decideRequest(db, key(), addReq5.requestId, true, null))) as { item_id: string }).item_id;
    const ct5 = await as(DOC, (db) => consentText(db, v5.visitId, v5.planId!));
    await as(DOC, (db) =>
      captureConsent(db, key(), { visitId: v5.visitId, planId: v5.planId!, signer: "patient", expectedHash: ct5.content_hash, signature: demoPng() }),
    );
    await as(FO, (db) => releaseAddition(db, key(), addItem5, FO.staffId));
    const ex5b = await as(DOC, (db) =>
      startTreatment(db, key(), v5.visitId, { planItemId: addItem5, performerId: DOC.staffId, roomId: r1TreatB, identityConfirmed: true }),
    );
    await as(DOC, (db) => finishTreatment(db, key(), ex5b.executionId, { outcome: "completed" }));
    const inv5Add = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: patientIds[4], visitId: v5.visitId }));
    await as(FO, (db) => issueKasirInvoice(db, key(), inv5Add.invoiceId, [{ itemId: svcPeel.itemId, quantity: 1, planItemId: addItem5 }]));
    await as(FO, (db) => convertToReceivable(db, key(), v5.visitId));
    await as(FO, (db) => closeVisit(db, key(), v5.visitId));

    // Visit 6 & 7 (Cross-Branch Package sale at b1 -> 1 session redeemed at b1, 1 session redeemed at b2).
    const invPkg = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: patientIds[5] }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invPkg.invoiceId, [{ itemId: pkgGlow.itemId, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invPkg.invoiceId, [{ method: "cash", amount: 2_750_000, cashTendered: 2_750_000 }]));
    const pkgId = await as(FO, async (db) => {
      const r = await db.query<{ id: string }>(`select id from packages where invoice_id = $1`, [invPkg.invoiceId]);
      return r.rows[0].id;
    });
    for (const branchId of [b1, b2]) {
      const vp = await runClinicalVisit({
        patientId: patientIds[5],
        branchId,
        versions: [svcFacial.versionId],
        complaint: `Redeem paket Facial Glow di cabang ${branchId === b1 ? "Kemang" : "Menteng"}`,
      });
      visitsCount++;
      await as(FO, (db) => reserveSession(db, key(), pkgId, vp.visitId), { branchId });
      const exp = await as(
        DOC,
        (db) =>
          startTreatment(db, key(), vp.visitId, {
            planItemId: vp.planItemIds[0],
            performerId: DOC.staffId,
            roomId: branchId === b1 ? r1TreatA : r2TreatA,
            identityConfirmed: true,
          }),
        { branchId },
      );
      await as(DOC, (db) => finishTreatment(db, key(), exp.executionId, { outcome: "completed" }), { branchId });
      await as(FO, (db) => closeVisit(db, key(), vp.visitId), { branchId });
    }

    // Patient balance top-up via transfer.
    await as(FO, (db) =>
      topUpBalance(db, key(), patientIds[6], null, {
        method: "transfer",
        amount: 1_000_000,
        details: { bank: "BCA", reference: "TRF-TOPUP-DEMO-01" },
      }),
    );

    // Open Visit 8 (Today, Intake SENT -> ready in Doctor's Antrean Dokter `/pemeriksaan`).
    await runClinicalVisit({
      patientId: patientIds[7],
      branchId: b1,
      versions: [],
      complaint: "Konsultasi kemerahan ringan dan rencana laser",
    });
    visitsCount++;

    // Open Visit 9 (Today, Paid + Consented + Product selected -> ready in Nurse/Therapist Ruang Saya AND Pharmacist Siapkan).
    const v9 = await runClinicalVisit({
      patientId: patientIds[8],
      branchId: b1,
      versions: [svcFacial.versionId],
      complaint: "Facial Glow hari ini + serum pencerah",
      assignBc: true,
    });
    visitsCount++;
    const sel9 = await as(BC, (db) =>
      confirmSelection(db, key(), v9.visitId, {
        items: [
          { planItemId: v9.planItemIds[0] },
          { catalogVersionId: prdSerum.versionId, quantity: "1" },
        ],
        guidingBcId: BC.staffId,
        closingBcId: BC.staffId,
      }),
    );
    const v9SelProdId = await as(PH, async (db) => {
      const r = await db.query<{ id: string }>(
        `select id from selection_items where selection_id = $1 and catalog_version_id = $2 limit 1`,
        [sel9.selectionId, prdSerum.versionId],
      );
      return r.rows[0].id;
    });
    const inv9 = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: patientIds[8], visitId: v9.visitId }));
    const iss9 = await as(FO, (db) =>
      issueKasirInvoice(db, key(), inv9.invoiceId, [
        { itemId: svcFacial.itemId, quantity: 1 },
        { itemId: prdSerum.itemId, quantity: 1, selectionItemId: v9SelProdId },
      ]),
    );
    await as(FO, (db) => receivePayment(db, key(), inv9.invoiceId, [{ method: "cash", amount: iss9.total, cashTendered: iss9.total }]));

    // 11. Appointments over today + next 14 days.
    let appointmentsCount = 0;
    const bookNextAvailable = async (
      branchId: string,
      patientId: string,
      versionId: string,
      date: string,
      optsB: { staffId?: string; hold?: boolean; channel?: "whatsapp" | "phone" | "staff" } = {},
    ) => {
      const avail = await as(FO, (db) => slots(db, { branchId, versionId, date, staffId: optsB.staffId ?? null }), { branchId });
      if (avail.length === 0) return null;
      const chosen = avail[Math.min(avail.length - 1, appointmentsCount % avail.length)];
      const booked = await as(
        FO,
        (db) =>
          book(db, key(), {
            branchId,
            patientId,
            versionId,
            startsAt: chosen.startsAt,
            staffId: chosen.staffId,
            channel: optsB.channel ?? "whatsapp",
            hold: optsB.hold ?? false,
          }),
        { branchId },
      );
      appointmentsCount++;
      return booked;
    };

    const todaySlots = await as(FO, (db) => slots(db, { branchId: b1, versionId: svcFacial.versionId, date: dbToday }));
    if (todaySlots.length > 0) {
      const lastSlot = todaySlots[todaySlots.length - 1];
      const apToday = await as(FO, (db) =>
        book(db, key(), {
          branchId: b1,
          patientId: patientIds[9],
          versionId: svcFacial.versionId,
          startsAt: lastSlot.startsAt,
          staffId: lastSlot.staffId,
          channel: "whatsapp",
        }),
      );
      appointmentsCount++;
      await as(FO, (db) => confirmAttendance(db, key(), apToday.appointmentId));
    }

    const ap1 = await bookNextAvailable(b1, patientIds[10], svcFacial.versionId, addDays(dbToday, 1));
    if (ap1) await as(FO, (db) => confirmAttendance(db, key(), ap1.appointmentId));

    const ap2 = await bookNextAvailable(b1, patientIds[11], svcPeel.versionId, addDays(dbToday, 2));
    if (ap2) {
      const resSlots = await as(FO, (db) => slots(db, { branchId: b1, versionId: svcPeel.versionId, date: addDays(dbToday, 3) }));
      if (resSlots.length > 0) {
        await as(FO, (db) => reschedule(db, key(), ap2.appointmentId, resSlots[0].startsAt, resSlots[0].staffId));
      }
    }

    const ap3 = await bookNextAvailable(b1, patientIds[12], svcHydra.versionId, addDays(dbToday, 4));
    if (ap3) await as(FO, (db) => cancelAppointment(db, key(), ap3.appointmentId, "Pasien meminta penjadwalan ulang pekan depan"));

    await as(OWN, (db) =>
      changeSetting(db, {
        key: "SET-10",
        branchId: null,
        value: { dp_booking: true, batas_ubah: 24 } as never,
        reason: "Aktifkan DP booking untuk skenario staging demo",
      }),
    );
    const apDp = await bookNextAvailable(b1, patientIds[13], svcLaser.versionId, addDays(dbToday, 5), {
      staffId: DOC.staffId,
      hold: true,
    });
    if (apDp) {
      await as(FO, (db) => receiveDeposit(db, key(), apDp.appointmentId, { method: "cash", cashTendered: 300_000 }));
    }

    await bookNextAvailable(b1, patientIds[14], svcFacial.versionId, addDays(dbToday, 6), { channel: "phone" });
    await bookNextAvailable(b2, patientIds[20], svcFacial.versionId, addDays(dbToday, 1), { channel: "whatsapp" });
    await bookNextAvailable(b2, patientIds[21], svcLaser.versionId, addDays(dbToday, 3), { staffId: DOC.staffId, channel: "staff" });

    await as(CS, (db) =>
      addToWaitlist(db, key(), {
        branchId: b1,
        patientId: patientIds[15],
        itemId: svcLaser.itemId,
      }),
    );

    // 12. Expenses (bank-funded at b1 & b2) + Commission Draft Batch.
    const expCatOps = (await as(FIN, (db) => saveExpenseCategory(db, key(), null, { name: "Operasional Cabang" }))).categoryId;
    const expCatUtil = (await as(FIN, (db) => saveExpenseCategory(db, key(), null, { name: "Listrik & Utilitas" }))).categoryId;
    await as(FIN, (db) =>
      recordExpense(db, key(), b1, {
        categoryId: expCatOps,
        businessDate: dbToday,
        amount: 350_000,
        funding: "bank",
        description: "Pengiriman perlengkapan steril Kemang",
      }),
    );
    await as(FIN, (db) =>
      recordExpense(db, key(), b2, {
        categoryId: expCatUtil,
        businessDate: dbToday,
        amount: 425_000,
        funding: "bank",
        description: "Tagihan internet dan utilitas Menteng",
      }),
    );
    const expensesCount = 2;

    await as(FIN, (db) => openBatch(db, key(), currentMonth));

    // 13. CRM Leads, Open Clinical Complaint, Safety Incident & Logbook, Follow-up scan.
    const leadSpecs = [
      { source: "instagram" as const, name: "Calon Pasien Sinta", phone: "+6281100007001", stage: "contacted" as const },
      { source: "whatsapp" as const, name: "Calon Pasien Melati", phone: "+6281100007002", stage: "contacted" as const },
      { source: "tiktok" as const, name: "Calon Pasien Ririn", phone: "+6281100007003", stage: "new" as const },
      { source: "website" as const, name: "Calon Pasien Ratna", phone: "+6281100007004", stage: "new" as const },
      { source: "referral" as const, name: "Calon Pasien Dian", phone: "+6281100007005", stage: "contacted" as const },
    ];
    for (const ls of leadSpecs) {
      const ld = await as(CS, (db) =>
        createLead(db, key(), {
          source: ls.source,
          branchId: b1,
          contactName: ls.name,
          contactPhone: ls.phone,
        }),
      );
      if (ls.stage !== "new") {
        await as(CS, (db) => setLeadStage(db, key(), ld.leadId, { to: ls.stage }));
      }
    }

    await as(NUR, (db) =>
      flagComplaint(db, key(), {
        patientId: patientIds[1],
        kind: "klinis",
        source: "visit_note",
        visitId: v2.visitId,
        triage: "kuning",
        summary: "Kemerahan ringan 6 jam pasca laser; dijadwalkan evaluasi dokter",
      }),
    );

    await as(NUR, (db) =>
      reportIncident(db, key(), b1, {
        classification: "knc",
        occurredAt: new Date().toISOString(),
        summary: "Label botol toner hampir tertukar sebelum verifikasi ganda",
        immediateResponse: "Verifikasi ulang dilakukan sebelum tindakan, tidak mengenai pasien",
        patientId: patientIds[0],
        visitId: v1.visitId,
      }),
    );

    await as(NUR, (db) =>
      recordEntry(db, key(), b1, {
        kind: "sterilization",
        performedOn: dbToday,
        method: "autoclave",
        items: "Set ekstraktor komedo & pinset steril (12 set)",
        passed: true,
        cycleNo: "AUT-DEMO-01",
        roomId: r1TreatA,
      }),
    );
    await as(MGR, (db) =>
      recordEntry(db, key(), b1, {
        kind: "calibration",
        performedOn: dbToday,
        deviceId: devLaser1,
        result: "ok",
        performerName: "Teknisi Kalibrasi Sintetis",
        certificateNo: "KAL-DEMO-2026",
      }),
    );

    await runFollowupScan(appPool, dbToday);

    // 14. Drain the real outbox posting consumer and verify event-driven completeness from
    //     eligible `domain_events` LEFT JOIN `event_receipts` + non-empty `journal_entries`
    //     BEFORE publishing credentials.
    let outboxSkipped = 0;
    let outboxFailed = 0;
    for (let i = 0; i < 30; i++) {
      assertFenceAlive();
      const [batch] = await runOutboxBatch(appPool, [ledgerPostingConsumer], {
        worker: "hyg-demo-seed",
        limit: 200,
        leaseSeconds: 15,
      });
      outboxSkipped += batch.skipped;
      outboxFailed += batch.failed;
      if (batch.done + batch.skipped + batch.failed === 0) break;
    }
    if (outboxFailed > 0) {
      throw new Error(`demo seed outbox ledger posting had ${outboxFailed} failed event(s)`);
    }

    assertFenceAlive();
    const completeness = (
      await seedLockClient.query<{
        eligible: number;
        missing_receipt: number;
        done: number;
        pending: number;
        leased: number;
        dead_letter: number;
        journal_entries: number;
      }>(
        `select count(*)::int as eligible,
                count(*) filter (where r.id is null)::int as missing_receipt,
                count(*) filter (where r.done_at is not null)::int as done,
                count(*) filter (where r.id is not null and r.done_at is null and (r.lease_until is null or r.lease_until <= clock_timestamp()))::int as pending,
                count(*) filter (where r.id is not null and r.done_at is null and r.lease_until > clock_timestamp())::int as leased,
                count(*) filter (where r.id is not null and r.done_at is null and r.attempts >= c.max_attempts)::int as dead_letter,
                (select count(*)::int from public.journal_entries je where je.tenant_id = $1) as journal_entries
           from public.domain_events e
           join public.event_consumers c on c.name = $2
           left join public.event_receipts r
             on r.tenant_id = e.tenant_id
            and r.event_id = e.id
            and r.consumer = c.name
          where e.tenant_id = $1
            and ('*' = any(c.event_types) or e.type = any(c.event_types))`,
        [tenantId, LEDGER_CONSUMER],
      )
    ).rows[0];

    if (
      completeness.eligible <= 0 ||
      completeness.missing_receipt !== 0 ||
      completeness.done !== completeness.eligible ||
      completeness.pending !== 0 ||
      completeness.leased !== 0 ||
      completeness.dead_letter !== 0 ||
      completeness.journal_entries <= 0
    ) {
      throw new Error(
        `demo seed outbox completeness failed for ${LEDGER_CONSUMER}: ${JSON.stringify(completeness)}`,
      );
    }

    // Final fence liveness ping before publishing credentials.
    assertFenceAlive();
    await seedLockClient.query(`select 1`);

    // 15. Write runtime-generated credentials strictly outside the repository (atomic mode 0600).
    const writtenPath = writeCredentialsFile(
      opts.credentialsOutputPath,
      {
        generatedAt: new Date().toISOString(),
        environment: "staging",
        dataClass: "synthetic",
        tenantId,
        branches: [
          { id: b1, code: "KMG", name: "Klinik Estetika Kemang" },
          { id: b2, code: "MNT", name: "Klinik Estetika Menteng" },
        ],
        accounts: credentialRecords,
      },
      { repoRoot },
    );

    const accountSummaries: SeedAccountSummary[] = [
      {
        role: "platform_owner",
        email: vendorEmail,
        displayName: "Platform Owner Staging",
        accountId: vendorUser.id,
        staffId: vendorOwnerStaffId,
        branches: [],
        totpEnrolled: true,
      },
      {
        role: "vendor_onboarding",
        email: onbEmail,
        displayName: "Tim Onboarding & Keuangan Staging",
        accountId: onbUser.id,
        staffId: vendorOnboardingStaffId,
        branches: [],
        totpEnrolled: true,
      },
      ...ROLES.map((r) => ({
        role: r,
        email: actors[r].email,
        displayName: actors[r].displayName,
        accountId: actors[r].accountId,
        staffId: actors[r].staffId,
        branches: actors[r].branches,
        totpEnrolled: actors[r].totpEnrolled,
      })),
    ];

    void AP;
    void RO;
    void AU;
    void r1Consult;

    return {
      tenantId,
      branches: [
        { id: b1, code: "KMG", name: "Klinik Estetika Kemang" },
        { id: b2, code: "MNT", name: "Klinik Estetika Menteng" },
      ],
      vendorOwnerStaffId,
      vendorOnboardingStaffId,
      accounts: accountSummaries,
      credentialsFile: writtenPath,
      counts: {
        staff: ROLES.length,
        services: services.size,
        products: products.size,
        packages: 3,
        patients: patientIds.length,
        appointments: appointmentsCount,
        visits: visitsCount,
        expenses: expensesCount,
        leads: leadSpecs.length,
        complaints: 1,
        incidents: 1,
        stockItems: stockItemIds.size,
      },
      outboxDrained: {
        eligible: completeness.eligible,
        missingReceipt: completeness.missing_receipt,
        done: completeness.done,
        pending: completeness.pending,
        leased: completeness.leased,
        deadLetter: completeness.dead_letter,
        journalEntries: completeness.journal_entries,
        skipped: outboxSkipped,
        failed: outboxFailed,
      },
    };
  } finally {
    expectedFenceClose = true;
    if (seedLockClient) {
      if (inFenceTx) {
        await seedLockClient.query(`commit`).catch(() => seedLockClient!.query(`rollback`).catch(() => {}));
      }
      seedLockClient.release(fenceLost ?? undefined);
    }
    await vendorPool?.end().catch(() => {});
    await appPool?.end().catch(() => {});
    await authPool?.end().catch(() => {});
    await ownerPool.end().catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ownerDatabaseUrl = process.env.DATABASE_URL;
  const appDatabaseUrl = process.env.APP_DATABASE_URL;
  const authDatabaseUrl = process.env.AUTH_DATABASE_URL;
  const vendorDatabaseUrl = process.env.VENDOR_DATABASE_URL;
  const credentialsOutputPath = process.env.DEMO_CREDENTIALS_FILE;
  const appUrl = process.env.APP_URL;
  const vendorUrl = process.env.VENDOR_URL;
  const authSecret = process.env.BETTER_AUTH_SECRET;
  const vendorAllowlistCidr = process.env.DEMO_VENDOR_ALLOWLIST_CIDR;
  if (
    !ownerDatabaseUrl ||
    !appDatabaseUrl ||
    !authDatabaseUrl ||
    !vendorDatabaseUrl ||
    !credentialsOutputPath ||
    !appUrl ||
    !vendorUrl ||
    !authSecret ||
    !vendorAllowlistCidr
  ) {
    console.error(
      "DATABASE_URL, APP_DATABASE_URL, AUTH_DATABASE_URL, VENDOR_DATABASE_URL, DEMO_CREDENTIALS_FILE, APP_URL, VENDOR_URL, BETTER_AUTH_SECRET, and DEMO_VENDOR_ALLOWLIST_CIDR are required",
    );
    process.exit(1);
  }
  const summary = await seedStagingDemo({
    ownerDatabaseUrl,
    appDatabaseUrl,
    authDatabaseUrl,
    vendorDatabaseUrl,
    credentialsOutputPath,
    appUrl,
    vendorUrl,
    authSecret,
    vendorAllowlistCidr,
  });
  // Never print passwords or TOTP secrets — only non-secret counts and output path.
  console.log(JSON.stringify({ event: "staging_demo_seeded", ...summary }));
}
