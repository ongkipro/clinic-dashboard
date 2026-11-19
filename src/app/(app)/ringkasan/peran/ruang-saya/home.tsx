// Ruang Saya (UX-60, 19 §2.1; T-107): the nurse/therapist home, wired to existing readers (data.ts). Rendered by ../page.tsx
// (/ringkasan/peran) when the acting role is nurse or therapist; not a route of its own.
// Jadwal ruang hari ini = today's room visits grouped by room, as in Ruang (UX-9) → the visit in Ruang.
// Pasien berikutnya datang = patient, MRN, time and service only → that day in Jadwal.
// Komisi saya bulan ini = target_mine's commission_net for this month (gross + adjustments; K17 earned, Panel 2 slice 4).
import { PageTitle } from "../../../../../components/templates/templates";
import { EmptyState } from "../../../../../components/ui/states";
import type { ActingContext } from "../../../../../modules/org/identity";
import type { RoomVisit } from "../../../../../modules/treatment/treatment";
import { STATE_LABEL } from "../../../ruang/labels";
import { type RoomGroup, type RoomSlot, RuangSayaView, type Widget } from "../ruang-saya-view";
import { loadRuangSaya, type Read } from "./data";

const SELF = "/ringkasan/peran";

function widget<T, U>(r: Read<T>, object: string, map: (d: T) => U): Widget<U> {
  if (r.kind === "ok") return { kind: "ok", data: map(r.data) };
  if (r.kind === "permission") return { kind: "permission", object };
  return { kind: "error", message: `${object[0].toUpperCase()}${object.slice(1)} belum dapat ditampilkan. Tidak ada yang berubah.`, retryHref: SELF };
}

// A visit's operational status, from the same execution states Ruang shows; no blocker or clinical text.
function status(v: RoomVisit): RoomSlot["status"] {
  if (v.closed) return { tone: "locked", label: "Kunjungan selesai" };
  const ex = v.items.map((i) => i.execution);
  if (ex.length > 0 && ex.every((e) => e?.state === "finished")) return { tone: "success", label: STATE_LABEL.finished };
  const live = ex.find((e) => e && e.state !== "finished");
  if (live) return { tone: "warning", label: STATE_LABEL[live.state] };
  if (ex.some((e) => e?.state === "finished")) return { tone: "warning", label: "Sebagian selesai" };
  return { tone: "neutral", label: "Belum dimulai" };
}

function groups(visits: RoomVisit[]): RoomGroup[] {
  const m = new Map<string, RoomGroup>();
  for (const v of visits) {
    const key = v.room?.id ?? "";
    const g = m.get(key) ?? { key: key || "none", roomName: v.room?.name ?? "Ruang belum ditentukan", slots: [] };
    g.slots.push({
      id: v.visit_id, href: `/ruang/${v.visit_id}`, at: v.checked_in_at, atLabel: "datang",
      patientName: v.patient_name, patientMrn: v.patient_mrn, serviceName: v.items.map((i) => i.name).join(", ") || "Tindakan", status: status(v),
    });
    m.set(key, g);
  }
  // Same order as Ruang: rooms by name, "belum ditentukan" last.
  return [...m.entries()].sort(([a, x], [b, y]) => (a === "" ? 1 : b === "" ? -1 : x.roomName.localeCompare(y.roomName, "id"))).map(([, g]) => g);
}

export async function RuangSayaHome({ context }: { context: ActingContext }) {
  const d = await loadRuangSaya(context);
  if (d.kind === "no-branch") return <><PageTitle title="Ruang Saya" /><EmptyState message="Pilih cabang aktif di Saya › Ganti Cabang." /></>;
  return (
    <RuangSayaView
      branchName={d.branchName}
      today={d.today}
      timeZone={d.timeZone}
      schedule={widget(d.rooms, "jadwal ruang", (l) => groups(l.visits))}
      nextPatient={widget(d.next, "jadwal janji", (a) => a && {
        id: a.id,
        // The established Jadwal day link (jadwal/page.tsx "Kelola"); today is the appointment's branch-local day.
        href: `/jadwal?cabang=${d.branchId}&tampilan=hari&tanggal=${d.today}`,
        at: a.startsAt.toISOString(),
        patientName: a.patientName,
        patientMrn: a.patientMrn,
        serviceName: a.serviceName,
      })}
      commission={widget(d.commission, "komisi saya", (t) => ({
        month: t.period,
        amount: t.scorecard.commission_net,
        basis: "Hak komisi dikurangi penyesuaian bulan ini, sebelum dibayarkan",
      }))}
    />
  );
}
