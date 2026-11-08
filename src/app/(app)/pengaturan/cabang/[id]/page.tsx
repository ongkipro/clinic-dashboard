// Cabang detail (UX-2, PR-2, T-036): sections Identitas, Jam Buka, Libur, Ruang & Alat, Layanan Tersedia,
// WhatsApp, Lokasi & Peta, Situs and Izin (SET-46), each with its own Simpan. Owner and Admin Pusat
// change every section; the manager changes Jam, Libur and Ruang & Alat of their own branch and reads
// the rest. The UX-2 blocked copy shows while the licence data is incomplete.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DetailPage } from "../../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../../components/ui/states";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import { licenceComplete } from "../../../../../modules/org/branches/branches";
import { loadBranch } from "../data";
import { ActiveToggle, AddClosureForm, DeviceForm, HoursForm, ProfileForm, RemoveClosure, RoomForm, ServicesForm } from "../forms";
import { DAYS, DEVICE_LABEL, ROOM_LABEL, TZ_LABEL } from "../labels";

export const metadata: Metadata = { title: "Cabang — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="@container m-0 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 @[30rem]:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] @[30rem]:gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--label-2)]">{k}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
const localDate = (d: Date | null, tz: string) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d) : "");
const dayLabel = (d: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await loadBranch(id);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="data cabang" />;
  if (p.kind === "not-found") notFound();
  const b = p.branch;
  const tz = b.timezone;
  const profile = (section: "identitas" | "kontak" | "lokasi" | "situs" | "izin", read: [string, string][]) =>
    p.full
      ? <ProfileForm ctx={p.ctx} branch={b.id} section={section} staff={p.staff} initial={{
          name: b.name, timezone: b.timezone, address: b.address ?? "", whatsapp_number: b.whatsappNumber ?? "", map_url: b.mapUrl ?? "",
          publish_from: localDate(b.publishFrom, tz), publish_until: localDate(b.publishUntil, tz), licence_number: b.licenceNumber ?? "", nib: b.nib ?? "",
          facility_code: b.facilityCode ?? "", satusehat_org_id: b.satusehatOrgId ?? "", responsible_staff_id: b.responsibleStaffId ?? "",
        }} />
      : <Facts rows={read} />;
  const sections = [
    { id: "identitas", label: "Identitas", content: profile("identitas", [["Nama", b.name], ["Kode", b.code], ["Zona waktu", TZ_LABEL[tz]], ["Alamat", b.address ?? "—"]]) },
    {
      id: "jam", label: "Jam Buka",
      content: <HoursForm ctx={p.ctx} branch={b.id} initial={p.hours} />,
    },
    {
      id: "libur", label: "Libur & Tutup Khusus",
      content: (
        <div className="grid min-w-0 gap-4">
          {p.closures.length === 0
            ? <p className="m-0">Belum ada libur terjadwal.</p>
            : (
              <ul aria-label="Libur terjadwal" className="m-0 grid list-none gap-3 p-0">
                {p.closures.map((c) => {
                  const label = `${dayLabel(c.date)}${c.from ? ` ${c.from}–${c.until}` : ""}`;
                  return (
                    <li key={c.id} className="grid min-w-0 gap-1">
                      <span className="font-semibold">{label}{c.from ? "" : " · sehari penuh"}</span>
                      <p className={`${muted} [overflow-wrap:anywhere]`}>{c.reason}</p>
                      <RemoveClosure ctx={p.ctx} branch={b.id} id={c.id} label={label} />
                    </li>
                  );
                })}
              </ul>
            )}
          <AddClosureForm ctx={p.ctx} branch={b.id} today={p.today} />
        </div>
      ),
    },
    {
      id: "ruang", label: "Ruang & Alat",
      content: (
        <div className="grid min-w-0 gap-5">
          <div className="grid min-w-0 gap-3">
            <h3 className="m-0 text-[1.05rem] font-semibold">Ruang</h3>
            {p.rooms.length === 0 && <p className="m-0">Belum ada ruang.</p>}
            {p.rooms.map((r) => (
              <div key={r.id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] border border-[var(--separator)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{r.name}</span>
                  <span className={muted}>{ROOM_LABEL[r.kind]}</span>
                  {!r.active && <StatusBadge tone="neutral">Nonaktif</StatusBadge>}
                </div>
                <RoomForm ctx={p.ctx} branch={b.id} room={r} />
                <ActiveToggle ctx={p.ctx} branch={b.id} id={r.id} what="room" active={r.active} name={r.name} />
              </div>
            ))}
            <RoomForm ctx={p.ctx} branch={b.id} />
          </div>
          <div className="grid min-w-0 gap-3">
            <h3 className="m-0 text-[1.05rem] font-semibold">Alat</h3>
            {p.devices.length === 0 && <p className="m-0">Belum ada alat.</p>}
            {p.devices.map((d) => (
              <div key={d.id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] border border-[var(--separator)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{d.label}</span>
                  <span className={muted}>{DEVICE_LABEL[d.type]}</span>
                  {!d.active && <StatusBadge tone="neutral">Nonaktif</StatusBadge>}
                </div>
                <DeviceForm ctx={p.ctx} branch={b.id} device={d} />
                <ActiveToggle ctx={p.ctx} branch={b.id} id={d.id} what="device" active={d.active} name={d.label} />
              </div>
            ))}
            <DeviceForm ctx={p.ctx} branch={b.id} />
          </div>
        </div>
      ),
    },
    {
      id: "layanan", label: "Layanan Tersedia",
      content: p.full
        ? (
          <div className="grid min-w-0 gap-2">
            {p.services.length === 0 && <p className="m-0">Belum ada layanan yang ditawarkan di cabang ini. Pilih layanan agar bisa dipesan.</p>}
            <ServicesForm ctx={p.ctx} branch={b.id} catalog={p.catalog} chosen={p.services} />
          </div>
        )
        : <p className="m-0">{p.services.length ? `${p.services.length} layanan ditawarkan di cabang ini.` : "Belum ada layanan yang ditawarkan di cabang ini."}</p>,
    },
    { id: "whatsapp", label: "Nomor WhatsApp", content: profile("kontak", [["WhatsApp", b.whatsappNumber ?? "—"]]) },
    { id: "lokasi", label: "Lokasi & Peta", content: profile("lokasi", [["Tautan peta", b.mapUrl ?? "—"]]) },
    { id: "situs", label: "Situs", content: profile("situs", [["Tayang mulai", localDate(b.publishFrom, tz) || "—"], ["Tayang sampai", localDate(b.publishUntil, tz) || "—"]]) },
    {
      id: "izin", label: "Izin",
      content: profile("izin", [["Nomor izin", b.licenceNumber ?? "—"], ["NIB", b.nib ?? "—"], ["Kode fasyankes", b.facilityCode ?? "—"], ["ID SATUSEHAT", b.satusehatOrgId ?? "—"]]),
    },
  ];
  return (
    <DetailPage
      title={b.name}
      subtitle={`Cabang · ${b.code} · ${TZ_LABEL[tz]}`}
      status={licenceComplete(b) ? { tone: "success", label: "Data izin lengkap" } : { tone: "warning", label: "Data izin belum lengkap" }}
      sections={sections}
    >
      {!licenceComplete(b) && <p role="note" className="m-0 font-semibold text-[var(--warning)]">Cabang belum punya kredensial SATUSEHAT</p>}
      <p className={muted}>Hari ini di cabang: {dayLabel(p.today)} ({DAYS[new Date(`${p.today}T12:00:00Z`).getUTCDay()]}).</p>
    </DetailPage>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat cabang" />}>
      <Body params={params} />
    </Suspense>
  );
}
