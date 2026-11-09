// Jadwal (UX-5, PR-83, T-045): one request in the active context. The nine booking roles read the
// calendar of a branch (Owner, Admin Pusat and Central CS any branch, others their own); the five writers
// get the row actions and Buat Janji. Patients are never listed here (plan r2 P1-2): a prefilled patient
// (?pasien=) is read alone in the minimal projection; FO/CS search on demand through a POST action.
import "server-only";
import { withTenantContext } from "../../../db/rls/context";
import { commercialCatalog } from "../../../modules/catalog/catalog";
import { type Branch, listBranches, offeredServices } from "../../../modules/org/branches/branches";
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { type Calendar, calendar } from "../../../modules/scheduling/appointments/appointments";

export const READERS = ["owner", "admin_pusat", "manager", "fo_cashier", "central_cs", "bc", "doctor", "nurse", "therapist"];
export const WRITERS = ["owner", "admin_pusat", "manager", "fo_cashier", "central_cs"];
export const SEARCHERS = ["fo_cashier", "central_cs"]; // patient_matches (T-037)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type View = "hari" | "minggu";
export type Picked = { id: string; mrn: string; fullName: string; birthYear: number; maskedPhone: string | null };
export type JadwalData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "no-branch" }
  | {
      kind: "ok"; ctx: RenderedContext; role: string; write: boolean; search: boolean; branches: Branch[]; branch: Branch; view: View; day: string; days: string[];
      today: string; cal: Calendar; services: { versionId: string; name: string }[]; patient: Picked | null; openNew: boolean; nowMs: number;
    };

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));

export async function loadJadwal(q: { cabang?: string; tampilan?: string; tanggal?: string; pasien?: string; aksi?: string }): Promise<JadwalData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !READERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const c = rc.active.context;
  const wide = ["owner", "admin_pusat", "central_cs"].includes(c.actingRole);
  const allowed = rc.active.branches.map((b) => b.id);
  return withTenantContext(await appPool(), c, async (db) => {
    const all = await listBranches(db);
    const branches = wide ? all : all.filter((b) => allowed.includes(b.id));
    const branch = branches.find((b) => b.id === q.cabang) ?? branches.find((b) => b.id === c.activeBranchId) ?? branches[0];
    if (!branch) return { kind: "no-branch" as const };
    const clock = (await db.query(`select to_char(clock_timestamp() at time zone $1, 'YYYY-MM-DD') as d, extract(epoch from clock_timestamp()) * 1000 as ms`, [branch.timezone])).rows[0];
    const today = clock.d as string;
    const view: View = q.tampilan === "minggu" ? "minggu" : "hari";
    const day = q.tanggal && DATE.test(q.tanggal) ? q.tanggal : today;
    const days = view === "minggu" ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mondayOf(day), i)) : [day];
    const write = WRITERS.includes(c.actingRole);
    const offered = new Set(await offeredServices(db, branch.id));
    const services = write
      ? (await commercialCatalog(db)).filter((r) => r.kind === "service" && offered.has(r.itemId)).map((r) => ({ versionId: r.versionId, name: r.name }))
      : [];
    // A prefilled patient: one row in the minimal projection, under RLS; unknown or foreign ids are ignored.
    let patient: Picked | null = null;
    if (write && q.pasien && UUID.test(q.pasien)) {
      const r = (await db.query(
        `select p.id, p.mrn, p.full_name, extract(year from p.birth_date)::int as y,
                -- the same mask as patient_match_rows (T-037)
                (select left(cp.value, 3) || repeat('•', greatest(length(cp.value) - 7, 0)) || right(cp.value, 4)
                   from contact_points cp where cp.patient_id = p.id and cp.kind = 'phone' and cp.is_primary) as phone
           from patients p where p.id = $1`,
        [q.pasien],
      )).rows[0];
      if (r) patient = { id: r.id, mrn: r.mrn, fullName: r.full_name, birthYear: r.y, maskedPhone: r.phone ?? null };
    }
    return {
      kind: "ok" as const, ctx: renderedContext(c), role: c.actingRole, write, search: SEARCHERS.includes(c.actingRole), branches, branch, view, day, days, today,
      cal: await calendar(db, branch.id, days[0], days[days.length - 1]), services, patient, openNew: write && (q.aksi === "baru" || patient !== null),
      nowMs: Number(clock.ms), // the database clock (render-time decisions use it, never Date.now in render)
    };
  });
}
