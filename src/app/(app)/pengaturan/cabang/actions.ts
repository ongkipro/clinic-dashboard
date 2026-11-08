"use server";
// Cabang actions (UX-2, PR-2, T-036): add a branch, save each section (profile, hours, services), add or
// remove a closure, add or change a room or device and (de)activate it. Each refuses a form rendered in
// another context first (HYG-009 B2-1); the database decides authority per section and validation.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import {
  addClosure, createBranch, type Interval, removeClosure, setDeviceActive, setHours, setRoomActive, setServices, updateProfile, upsertDevice, upsertRoom,
} from "../../../../modules/org/branches/branches";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export type CabangState = { error?: string; ok?: string; values?: Record<string, string>; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat mengubah bagian ini.",
  ERR_NOT_FOUND: "Cabang atau data tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data bentrok atau sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  hours_overlap: "Jam buka pada hari yang sama saling bertumpuk.",
  hours_range: "Jam tutup harus setelah jam buka.",
  hours_format: "Tulis jam dengan format JJ:MM, misalnya 09:00.",
  closure_date: "Tanggal libur tidak boleh sebelum hari ini (zona waktu cabang).",
  closure_overlap: "Sudah ada libur yang bertumpuk pada tanggal itu.",
  closure_past: "Libur yang sudah lewat tidak dapat dihapus.",
  branch_closures_range_check: "Isi jam mulai dan selesai, atau kosongkan keduanya untuk libur sehari penuh.",
  branch_closures_reason_check: "Tulis alasan libur (minimal 3 huruf).",
  branches_whatsapp_check: "Nomor WhatsApp harus berformat +62…",
  branches_map_url_check: "Tautan peta harus diawali https://",
  branches_nib_check: "NIB harus 13 digit.",
  branches_publish_check: "Akhir tayang harus setelah awal tayang.",
  responsible_staff: "Penanggung jawab harus staf aktif klinik ini.",
  services_only: "Pilih layanan yang sudah aktif di katalog.",
  room_name_used: "Nama ruang sudah dipakai di cabang ini.",
  device_label_used: "Nama alat sudah dipakai di cabang ini.",
  name: "Nama cabang 2–120 huruf.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$"))) as Record<string, string>;
const done = (prev: CabangState, s: CabangState): CabangState => ({ ...s, n: (prev.n ?? 0) + 1 });

async function run(prev: CabangState, f: FormData, branchId: string, work: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0]) => Promise<unknown>, ok: string): Promise<CabangState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return done(prev, { error: COPY.ERR_FORBIDDEN, values: keep(f) });
  if (staleContext(f, rc.active.context)) return done(prev, { error: STALE_CONTEXT, values: keep(f) });
  try {
    await withTenantContext(await appPool(), rc.active.context, work);
  } catch (e) {
    if (e instanceof CommandError) {
      const r = (e as { reason?: string }).reason ?? "";
      return done(prev, { error: COPY[r] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN, values: keep(f) });
    }
    console.error("cabang: save failed", { error: e instanceof Error ? e.name : "unknown" });
    return done(prev, { error: "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.", values: keep(f) });
  }
  revalidatePath("/pengaturan/cabang");
  if (branchId) revalidatePath(`/pengaturan/cabang/${branchId}`);
  return done(prev, { ok });
}

export async function createBranchAction(prev: CabangState, f: FormData): Promise<CabangState> {
  let id = "";
  const s = await run(prev, f, "", async (db) => { id = await createBranch(db, { code: str(f, "code"), name: str(f, "name"), timezone: str(f, "timezone") }); }, "Cabang ditambahkan.");
  if (s.ok && id) redirect(`/pengaturan/cabang/${id}`);
  return s;
}

export async function profileAction(prev: CabangState, f: FormData): Promise<CabangState> {
  const branchId = str(f, "branch");
  if (!UUID.test(branchId)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  const section = str(f, "section");
  // Only the fields of the posted section are sent; the others keep their value.
  const pick: Record<string, string[]> = {
    identitas: ["name", "timezone", "address"], kontak: ["whatsapp_number"], lokasi: ["map_url"],
    situs: ["publish_from", "publish_until"], izin: ["licence_number", "nib", "facility_code", "satusehat_org_id", "responsible_staff_id"],
  };
  if (!pick[section]) return done(prev, { error: COPY.ERR_INVALID_INPUT });
  if (section === "situs" && ["publish_from", "publish_until"].some((k) => str(f, k) && !/^\d{4}-\d{2}-\d{2}$/.test(str(f, k)))) {
    return done(prev, { error: "Pilih tanggal tayang.", values: keep(f) });
  }
  const fields: Record<string, string> = {};
  for (const k of pick[section]) {
    const v = str(f, k);
    // Publish window dates are local dates in the branch timezone: 00:00 there (converted in SQL).
    fields[k] = v;
  }
  return run(prev, f, branchId, async (db) => {
    if (section === "situs") {
      const tz = (await db.query(`select timezone from branches where id = $1`, [branchId])).rows[0]?.timezone as string | undefined;
      for (const k of ["publish_from", "publish_until"]) {
        if (fields[k] && /^\d{4}-\d{2}-\d{2}$/.test(fields[k]) && tz) {
          fields[k] = (await db.query(`select ($1::date::timestamp at time zone $2)::text as t`, [fields[k], tz])).rows[0].t;
        }
      }
    }
    await updateProfile(db, branchId, fields);
  }, "Tersimpan.");
}

// Weekly hours: seven day rows with up to two intervals each (h_<weekday>_<n>_open / _close), empty = closed.
export async function hoursAction(prev: CabangState, f: FormData): Promise<CabangState> {
  const branchId = str(f, "branch");
  if (!UUID.test(branchId)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  const weekly: Interval[] = [];
  for (let d = 0; d < 7; d++) {
    for (let i = 0; i < 2; i++) {
      const o = str(f, `h_${d}_${i}_open`);
      const c = str(f, `h_${d}_${i}_close`);
      if (!o && !c) continue;
      weekly.push({ weekday: d, opens: o, closes: c });
    }
  }
  return run(prev, f, branchId, (db) => setHours(db, branchId, weekly), "Jam buka tersimpan.");
}

export async function addClosureAction(prev: CabangState, f: FormData): Promise<CabangState> {
  const branchId = str(f, "branch");
  if (!UUID.test(branchId)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(f, "date"))) return done(prev, { error: "Pilih tanggal libur.", values: keep(f) });
  const t = (k: string) => (/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(str(f, k)) ? str(f, k) : str(f, k) ? "bad" : null);
  if (t("from") === "bad" || t("until") === "bad") return done(prev, { error: COPY.hours_format, values: keep(f) });
  return run(prev, f, branchId, (db) => addClosure(db, branchId, { date: str(f, "date"), from: t("from"), until: t("until"), reason: str(f, "reason") }), "Libur ditambahkan.");
}

export async function removeClosureAction(prev: CabangState, f: FormData): Promise<CabangState> {
  const branchId = str(f, "branch");
  const id = str(f, "id");
  if (!UUID.test(branchId) || !UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return run(prev, f, branchId, (db) => removeClosure(db, id), "Libur dihapus.");
}

export async function roomAction(prev: CabangState, f: FormData): Promise<CabangState> {
  const branchId = str(f, "branch");
  const id = str(f, "id");
  if (!UUID.test(branchId) || (id && !UUID.test(id))) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return run(prev, f, branchId, (db) => upsertRoom(db, branchId, { id: id || null, name: str(f, "name"), kind: str(f, "kind"), satusehatLocationId: str(f, "satusehat") || null }),
    id ? "Ruang diperbarui." : "Ruang ditambahkan.");
}

export async function deviceAction(prev: CabangState, f: FormData): Promise<CabangState> {
  const branchId = str(f, "branch");
  const id = str(f, "id");
  if (!UUID.test(branchId) || (id && !UUID.test(id))) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return run(prev, f, branchId, (db) => upsertDevice(db, branchId, { id: id || null, type: str(f, "type"), label: str(f, "label") }), id ? "Alat diperbarui." : "Alat ditambahkan.");
}

export async function activeAction(prev: CabangState, f: FormData): Promise<CabangState> {
  const branchId = str(f, "branch");
  const id = str(f, "id");
  const what = str(f, "what");
  const active = str(f, "active") === "1";
  if (!UUID.test(branchId) || !UUID.test(id) || !["room", "device"].includes(what)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return run(prev, f, branchId, (db) => (what === "room" ? setRoomActive(db, id, active) : setDeviceActive(db, id, active)), active ? "Diaktifkan." : "Dinonaktifkan.");
}

export async function servicesAction(prev: CabangState, f: FormData): Promise<CabangState> {
  const branchId = str(f, "branch");
  if (!UUID.test(branchId)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  const items = f.getAll("item").filter((x): x is string => typeof x === "string" && UUID.test(x));
  return run(prev, f, branchId, (db) => setServices(db, branchId, items), "Layanan tersedia tersimpan.");
}
