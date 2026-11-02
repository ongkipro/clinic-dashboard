// Log Audit (UX-31, PR-51): read-only list with filters by actor, acting role, object
// and time. Rendered on the server per request; never cached (TEN-4).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AUDIT_ACTIONS } from "../../../modules/audit/schema";
import { type AuditPage, loadAuditPage } from "../../../modules/audit/page-data";
import s from "./audit.module.css";

export const metadata: Metadata = { title: "Log Audit — Clinic Dashboard", robots: { index: false, follow: false } };

const ACTION_LABEL: Record<string, string> = {
  clinical_read: "Membuka rekam medis",
  media_view: "Melihat foto klinis",
  media_download: "Mengunduh foto klinis",
  export: "Ekspor data",
  access_denied: "Akses ditolak",
  break_glass: "Akses darurat (break-glass)",
  sign: "Menandatangani",
  approval: "Persetujuan",
  money_correction: "Koreksi uang",
  settings_change: "Perubahan pengaturan",
  operator_session: "Sesi dukungan vendor",
  context_selected: "Memilih peran dan cabang",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", admin_pusat: "Admin Pusat", manager: "Manajer", facility_head: "Penanggung Jawab Klinik",
  records_officer: "Perekam Medis", fo_cashier: "FO/Kasir", central_cs: "CS Pusat", bc: "BC", doctor: "Dokter",
  nurse: "Perawat", therapist: "Terapis", pharmacist: "Apoteker", finance: "Keuangan", marketing: "Marketing",
  purchasing: "Pembelian", auditor: "Auditor Internal",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

function dayStart(v?: string): Date | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? undefined : d; // e.g. 2026-13-45
}

async function AuditList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const action = one(q.aksi);
  const page: AuditPage = await loadAuditPage({
    tenantId: one(q.klinik),
    role: one(q.peran),
    filter: {
      actingRole: one(q.sebagai) || undefined,
      action: action && (AUDIT_ACTIONS as readonly string[]).includes(action) ? (action as never) : undefined,
      from: dayStart(one(q.dari)),
      to: (() => {
        const d = dayStart(one(q.sampai));
        return d ? new Date(d.getTime() + 86_400_000) : undefined;
      })(),
    },
  }).catch((e: unknown) => {
    if (e instanceof TypeError) return { kind: "forbidden" } as const; // malformed filter
    throw e;
  });

  if (page.kind === "redirect") redirect(page.to);
  if (page.kind === "forbidden") {
    return <p className={s.empty}>Anda tidak memiliki akses ke log audit.</p>;
  }
  return (
    <>
      {page.chainBrokenAt === null ? (
        <p className={`${s.banner} ${s.ok}`} role="status">Rantai log utuh.</p>
      ) : (
        <p className={`${s.banner} ${s.broken}`} role="alert">
          Rantai log rusak mulai entri #{page.chainBrokenAt}. Hubungi penanggung jawab keamanan.
        </p>
      )}
      {page.rows.length === 0 ? (
        <p className={s.empty}>Tidak ada entri log untuk filter ini.</p>
      ) : (
        <ul className={s.list} aria-label="Entri log audit">
          {page.rows.map((r) => (
            <li key={r.id} className={s.item}>
              <div className={s.row1}>
                <span className={s.action}>{ACTION_LABEL[r.action] ?? r.action}</span>
                <time className={s.time} dateTime={r.at}>{fmt.format(new Date(r.at))}</time>
              </div>
              <span className={s.meta}>
                Sebagai {r.actingRole ? (ROLE_LABEL[r.actingRole] ?? r.actingRole) : "layanan"} · staf {r.staffId?.slice(0, 8) ?? "—"}
                {r.objectId ? ` · ${r.objectKind} ${r.objectId.slice(0, 8)}` : ` · ${r.objectKind}`}
                {r.vendorSessionId ? " · sesi vendor" : ""} · #{r.seq}
              </span>
              {r.reason && <span className={s.reason}>Alasan: {r.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function AuditPageView({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main className={s.screen}>
      <div className={s.inner}>
        <h1 className={s.title}>Log Audit</h1>
        <p className={s.sub}>Akses rekam medis, akses darurat, persetujuan dan perubahan pengaturan.</p>
        <form className={s.filters} method="get" aria-label="Filter log audit">
          <Suspense>
            <HiddenContext searchParams={searchParams} />
          </Suspense>
          <div className={s.field}>
            <label className={s.label} htmlFor="aksi">Aksi</label>
            <select className={s.input} id="aksi" name="aksi" defaultValue="">
              <option value="">Semua aksi</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>{ACTION_LABEL[a]}</option>
              ))}
            </select>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="sebagai">Peran pelaku</label>
            <select className={s.input} id="sebagai" name="sebagai" defaultValue="">
              <option value="">Semua peran</option>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="dari">Dari tanggal</label>
            <input className={s.input} id="dari" name="dari" type="date" />
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="sampai">Sampai tanggal</label>
            <input className={s.input} id="sampai" name="sampai" type="date" />
          </div>
          <button className={s.button} type="submit">Terapkan</button>
        </form>
        <Suspense fallback={<p className={s.empty} aria-busy="true" />}>
          <AuditList searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function HiddenContext({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  return (
    <>
      <input type="hidden" name="klinik" value={one(q.klinik) ?? ""} />
      <input type="hidden" name="peran" value={one(q.peran) ?? ""} />
    </>
  );
}
