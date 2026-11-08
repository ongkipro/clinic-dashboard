"use server";
// Pendaftaran Pasien actions (UX-4, PR-5, T-037): "Cari dulu" and Daftarkan. Each refuses a form
// rendered in another context first (HYG-009 B2-1). The identity number is normalised, sealed and
// indexed here and never returned: the action state carries only the sealed pair and a masked display
// for the "Buat Baru" confirmation (plan r1 P1-2), and the posted pair is verified before use (r2 P3-1).
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { EncryptionUnavailableError } from "../../../../lib/keys/runtime";
import {
  findMatches, identityIndexForSearch, type IdentityType, type Match, normaliseIdentity, normalisePhone, registerPatient, type RegistrationFields,
  sealIdentity, verifySealed,
} from "../../../../modules/patients/patients";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";

const TYPES: IdentityType[] = ["nik", "passport", "kitas", "newborn_via_guardian"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Fields kept for a re-render after an error: never the identity number (plan r1 P1-2).
const KEEP = ["full_name", "birth_date", "sex", "phone", "identity_type", "no_identity_reason", "religion", "occupation", "education", "marital_status", "address", "branch_id", "g_name", "g_relation", "g_phone"];

export type SearchState = { error?: string; matches?: Match[]; searched?: boolean; values?: Record<string, string> };
export type RegisterState = {
  error?: string;
  values?: Record<string, string>;
  // The duplicate step: matches to choose from; for "duplicate_decision_required" a sealed identity to reuse.
  pause?: { code: "duplicate_identity" | "duplicate_decision_required"; matches: Match[]; sealed: { enc: string; bidx: string; masked: string } | null };
  done?: { patientId: string; mrn: string; name: string };
};

const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const keep = (f: FormData) => Object.fromEntries(KEEP.map((k) => [k, str(f, k)]).filter(([, v]) => v !== ""));

const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat mendaftarkan pasien.",
  ERR_NOT_FOUND: "Pilih cabang pendaftaran.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak menerima pasien baru.",
  ERR_VERSION_CONFLICT: "Identitas ini baru saja didaftarkan. Cari ulang pasiennya.",
  ERR_INVALID_INPUT: "Periksa kembali isian pasien.",
  guardian_required: "Pasien di bawah 18 tahun atau bayi baru lahir wajib punya wali.",
  required_fields: "Lengkapi jenis kelamin, agama, pekerjaan, pendidikan dan status perkawinan.",
  keys: "Kunci enkripsi belum dipasang. Pendaftaran dengan nomor identitas belum bisa dilakukan; hubungi admin vendor.",
  golive: "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).",
};

export async function searchAction(_p: SearchState, f: FormData): Promise<SearchState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  const by = str(f, "by");
  const q = str(f, "q");
  const values = { by };
  if (q.length < 2) return { error: "Isi kata pencarian.", values };
  try {
    const matches = await withTenantContext(await appPool(), rc.active.context, async (db) => {
      if (by === "phone") return normalisePhone(q) ? findMatches(db, { phone: q }) : null;
      if (by === "mrn") return findMatches(db, { mrn: q });
      if (by === "nik") {
        const n = normaliseIdentity("nik", q);
        if (!n) return null;
        const bidx = await identityIndexForSearch(db, rc.active.context.tenantId, "nik", n);
        return bidx ? findMatches(db, { identityBidx: bidx }) : [];
      }
      return findMatches(db, { name: q });
    });
    // The query itself is never echoed back (PR-76: request body only, no logs).
    if (matches === null) return { error: by === "nik" ? "NIK harus 16 digit." : "Nomor HP tidak valid.", values };
    return { matches, searched: true, values };
  } catch (e) {
    if (e instanceof EncryptionUnavailableError) return { error: COPY.keys, values };
    if (e instanceof CommandError) return { error: COPY[e.code] ?? COPY.ERR_FORBIDDEN, values };
    throw e;
  }
}

export async function registerAction(_p: RegisterState, f: FormData): Promise<RegisterState> {
  const values = keep(f);
  const type = str(f, "identity_type") as IdentityType;
  if (!TYPES.includes(type)) return { error: "Pilih jenis identitas.", values };
  const guardianName = str(f, "g_name");
  const fields: RegistrationFields = {
    full_name: str(f, "full_name"), birth_date: str(f, "birth_date"), sex: str(f, "sex") as RegistrationFields["sex"], phone: str(f, "phone"),
    identity_type: type, no_identity_reason: str(f, "no_identity_reason") || null, religion: str(f, "religion"), occupation: str(f, "occupation"),
    education: str(f, "education"), marital_status: str(f, "marital_status"), address: str(f, "address") || null,
    branch_id: UUID.test(str(f, "branch_id")) ? str(f, "branch_id") : null,
    guardian: guardianName ? { name: guardianName, relation: str(f, "g_relation"), phone: str(f, "g_phone") || null } : null,
  };
  if (fields.full_name.length < 2) return { error: "Isi nama lengkap.", values };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.birth_date)) return { error: "Isi tanggal lahir.", values };
  if (!normalisePhone(fields.phone)) return { error: "Nomor HP tidak valid.", values };
  if (type !== "nik" && (fields.no_identity_reason ?? "").length < 3) return { error: "Tulis alasan tanpa NIK.", values };
  // Review r1 P3-3: every required field before any duplicate pause (the database checks them too).
  if (!["female", "male"].includes(fields.sex) || !fields.religion || !fields.education || !fields.marital_status || fields.occupation.length < 2) {
    return { error: "Lengkapi jenis kelamin, agama, pekerjaan, pendidikan dan status perkawinan.", values };
  }
  const decision = str(f, "decision") === "new" ? "new" : null;
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT, values };
  const tenantId = rc.active.context.tenantId;
  try {
    const out = await withTenantContext(await appPool(), rc.active.context, async (db) => {
      let sealed: { enc: string; bidx: string; masked: string } | null = null;
      if (type !== "newborn_via_guardian") {
        const postedEnc = str(f, "sealed_enc");
        const postedBidx = str(f, "sealed_bidx");
        if (decision === "new" && postedEnc && postedBidx) {
          // The confirmation reuses the sealed pair; it must open and index to itself (r2 P3-1).
          const masked = await verifySealed(db, tenantId, type, postedEnc, postedBidx);
          if (!masked) return { error: "Data identitas tidak valid. Isi ulang nomor identitas." } as RegisterState;
          sealed = { enc: postedEnc, bidx: postedBidx, masked };
        } else {
          const n = normaliseIdentity(type, str(f, "identity_number"));
          if (!n) return { error: type === "nik" ? "NIK harus 16 digit." : "Nomor identitas tidak valid." } as RegisterState;
          sealed = await sealIdentity(db, tenantId, type, n);
        }
      }
      const r = await registerPatient(db, fields, sealed ? { enc: sealed.enc, bidx: sealed.bidx } : null, decision);
      if (r.ok) return { done: { patientId: r.patientId, mrn: r.mrn, name: fields.full_name } } as RegisterState;
      return { pause: { code: r.code, matches: r.matches, sealed: r.code === "duplicate_decision_required" ? sealed : null } } as RegisterState;
    });
    return { ...out, values: out.done ? undefined : values };
  } catch (e) {
    if (e instanceof EncryptionUnavailableError) return { error: COPY.keys, values };
    if (e instanceof GoLiveBlockedError) return { error: COPY.golive, values };
    if (e instanceof CommandError) {
      const reason = (e as { reason?: string }).reason;
      return { error: (reason && COPY[reason]) || COPY[e.code] || COPY.ERR_FORBIDDEN, values };
    }
    console.error("pasien-baru: register failed", { error: e instanceof Error ? e.name : "unknown" });
    return { error: "Pendaftaran belum pasti tersimpan. Cari pasiennya dulu sebelum mencoba lagi.", values };
  }
}
