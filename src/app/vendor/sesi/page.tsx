// Konsol Vendor › Sesi Dukungan (UX-44, 19 §3; T-129 vendor UI subset). Read only: the list of support sessions from the existing
// reader vendor_console_support_list (0046 / 0049) through listSessions (authority re-check, HYG-008b). Support and onboarding open it
// (19 §3); another vendor role gets the permission state and no reader is called.
// The reader also answers the session's free-text purpose, the operator's name and the end reason. This list shows none of them
// (PR-60): `projectRows` (model.ts) names the only fields that leave the reader's answer. Opening, extending and ending a session are
// not on this page.
// Tenant names are tenant-controlled: rendered as React text (escaped, SEC-21).
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { listSessions } from "../../../modules/vendor/support/support";
import { call, type Caller, consoleGate, vendorPool } from "../_lib/server";
import { ConsoleShell, mayOpen, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";
import type { TenantRow } from "../tenant/tenant-list";
import { projectRows, type Row } from "./model";
import s from "../_lib/console.module.css";

const HREF = "/vendor/sesi";
const TITLE = "Sesi Dukungan";
const LEAD = "Klinik, status, lingkup dan waktu tiap sesi. Tujuan sesi tidak ditampilkan di daftar ini; pengajuan dan perpanjangan sesi belum tersedia di halaman ini.";

const STATE: Record<Row["state"], { label: string; tone: string }> = {
  // Short on purpose: a badge does not wrap, and the longer wording overflowed the card at 390 px with 200 % text.
  pending_approval: { label: "Menunggu Owner", tone: s.toneWarning },
  active: { label: "Aktif", tone: s.toneSuccess },
  expired: { label: "Kedaluwarsa", tone: s.toneNeutral },
  ended: { label: "Selesai", tone: s.toneNeutral },
};

type Read = { kind: "ok"; rows: Row[]; names: Map<string, string | null> } | { kind: "permission" } | { kind: "error" } | { kind: "not-found" };
const refused = (reason: string | undefined): Read => (reason === "role_not_held" ? { kind: "permission" } : { kind: "error" });

async function read(caller: Caller, tenantId: string | null): Promise<Read> {
  try {
    const t = await call<{ rows: TenantRow[] }>("vendor_console_tenants", caller);
    if (!t.ok) return refused(t.reason);
    const names = new Map(t.data.rows.map((x) => [x.id, x.name]));
    // A well-formed id that names no tenant is not found; it is never read as "all tenants".
    if (tenantId && !names.has(tenantId)) return { kind: "not-found" };
    const r = await listSessions(await vendorPool(), caller, tenantId);
    if (!r.ok) return refused(r.reason);
    const rows = projectRows(r.data.rows);
    return rows ? { kind: "ok", rows, names } : { kind: "error" };
  } catch (e) {
    // The code only: a database error message can quote row values.
    console.error("vendor/sesi: read failed", (e as { code?: string }).code ?? "unknown");
    return { kind: "error" };
  }
}

const at = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const when = (iso: string) => `${at.format(new Date(iso))} WIB`;
const deadline = (r: Row) => (r.endsAt ? when(r.endsAt) : r.state === "pending_approval" ? "Setelah disetujui" : "Belum ditetapkan");
const kinds = (n: number) => `${n} jenis objek`;
const NO_NAME = "Belum ada nama badan usaha";

function Head() {
  return (
    <>
      <h1 className={s.title}>{TITLE}</h1>
      <p className={s.lead}>{LEAD}</p>
    </>
  );
}

function Sessions({ rows, names }: { rows: Row[]; names: Map<string, string | null> }) {
  const name = (r: Row) => names.get(r.tenantId) ?? NO_NAME;
  const clinic = (r: Row) => (
    <Link prefetch={false} className={s.cardLink} href={`${HREF}?tenant=${r.tenantId}`}>
      {name(r)}
    </Link>
  );
  const badge = (r: Row) => <span className={`${s.badge} ${STATE[r.state].tone}`}>{STATE[r.state].label}</span>;
  return (
    <>
      <div className={s.tableWrap} role="region" aria-label="Daftar sesi dukungan" tabIndex={0}>
        <table className={s.table}>
          <caption className="sr-only">Daftar sesi dukungan</caption>
          <thead>
            <tr>
              <th scope="col">Klinik</th>
              <th scope="col">Status</th>
              <th scope="col">Lingkup</th>
              <th scope="col">Diajukan</th>
              <th scope="col">Batas waktu</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-session={r.id} data-state={r.state}>
                <th scope="row">
                  {clinic(r)}
                  <p className={s.help}>ID sesi {r.id}</p>
                </th>
                <td>{badge(r)}</td>
                <td>{kinds(r.kinds)}</td>
                <td>{when(r.requestedAt)}</td>
                <td>{deadline(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={s.cards} aria-label="Daftar sesi dukungan">
        {rows.map((r) => (
          <li key={r.id} className={s.card} data-session={r.id} data-state={r.state}>
            <p className={s.cardTitle}>{clinic(r)}</p>
            <p className={s.boxText}>{badge(r)}</p>
            <dl className={s.cardMeta}>
              <dt>Lingkup</dt>
              <dd>{kinds(r.kinds)}</dd>
              <dt>Diajukan</dt>
              <dd>{when(r.requestedAt)}</dd>
              <dt>Batas waktu</dt>
              <dd>{deadline(r)}</dd>
            </dl>
            <p className={s.help}>ID sesi {r.id}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

export default async function SesiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const shell = (body: React.ReactNode) => <ConsoleShell user={gate.user} current={HREF}>{body}</ConsoleShell>;
  if (!mayOpen(gate.user.roles, HREF)) return shell(<PermissionState title={TITLE} />);
  const tenant = tenantParam((await searchParams).tenant);
  if (tenant.kind === "invalid") notFound();
  const tenantId = tenant.kind === "tenant" ? tenant.id : null;
  const r = await read(gate.caller, tenantId);
  if (r.kind === "not-found") notFound();
  if (r.kind === "permission") return shell(<PermissionState title={TITLE} />);
  if (r.kind === "error") {
    return shell(
      <div className={s.page}>
        <Head />
        <div className={s.box} role="alert">
          <p className={s.boxText}>Daftar sesi dukungan belum dapat dimuat.</p>
          <Link prefetch={false} href={tenantId ? `${HREF}?tenant=${tenantId}` : HREF} className={s.plain}>
            Coba Lagi
          </Link>
        </div>
      </div>,
    );
  }
  return shell(
    <div className={s.page}>
      <Head />
      {tenantId && (
        <div className={s.actions}>
          <p className={s.boxMuted}>Klinik: {r.names.get(tenantId) ?? NO_NAME}</p>
          <Link prefetch={false} href={HREF} className={s.plain}>
            Semua klinik
          </Link>
        </div>
      )}
      {r.rows.length === 0 ? (
        <div className={s.box} role="status" data-state={tenantId ? "filtered-empty" : "empty"}>
          <p className={s.boxMuted}>{tenantId ? "Tidak ada sesi dukungan untuk klinik ini." : "Belum ada sesi dukungan."}</p>
        </div>
      ) : (
        <Sessions rows={r.rows} names={r.names} />
      )}
    </div>,
  );
}
