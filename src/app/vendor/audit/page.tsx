// Konsol Vendor › Audit Vendor (UX-47, 19 §3; T-129 + HYG-024). Platform owner & vendor auditor only; masked client IP.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { listVendorActions } from "../../../modules/vendor/console/console";
import { consoleGate, vendorPool } from "../_lib/server";
import { ConsoleShell, mayOpen, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";
import s from "../_lib/console.module.css";
import { AuditExportForm } from "./actions";

const HREF = "/vendor/audit";
const TITLE = "Audit Vendor";
const LEAD = "Catatan aksi staf vendor (alamat IP dimask /24, ekspor CSV berbatas kuota).";

const fmtAt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const when = (iso: string) => {
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? `${fmtAt.format(new Date(ts))} WIB` : iso;
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ tenant?: string | string[] }> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const shell = (body: React.ReactNode) => <ConsoleShell user={gate.user} current={HREF}>{body}</ConsoleShell>;
  if (!mayOpen(gate.user.roles, HREF)) return shell(<PermissionState title={TITLE} />);

  const tp = tenantParam((await searchParams).tenant);
  if (tp.kind === "invalid") notFound();
  const tenantId = tp.kind === "tenant" ? tp.id : null;

  let res;
  try {
    res = await listVendorActions(await vendorPool(), gate.caller, { tenantId, limit: 100 });
  } catch (e) {
    console.error("vendor/audit: read failed", (e as { code?: string }).code ?? "unknown");
    res = { ok: false as const, code: "ERR_INTERNAL", reason: "read_error" };
  }
  if (!res.ok) {
    if (res.code === "ERR_NOT_FOUND") notFound();
    if (res.reason === "role_not_held") return shell(<PermissionState title={TITLE} />);
    return shell(
      <div className={s.page}>
        <h1 className={s.title}>{TITLE}</h1>
        <p className={s.lead}>{LEAD}</p>
        <div className={s.box} role="alert" data-state="error">
          <p className={s.boxText}>Log audit vendor belum dapat dimuat.</p>
          <Link prefetch={false} href={tenantId ? `${HREF}?tenant=${tenantId}` : HREF} className={s.plain}>
            Coba Lagi
          </Link>
        </div>
      </div>,
    );
  }

  const rows = res.data.rows;
  return shell(
    <div className={s.page}>
      <h1 className={s.title}>{TITLE}</h1>
      <p className={s.lead}>{LEAD}</p>
      {tenantId ? (
        <p className={s.boxMuted}>
          Filter klinik aktif ·{" "}
          <Link prefetch={false} href={HREF} className={s.plain}>
            Semua klinik
          </Link>
        </p>
      ) : null}
      <AuditExportForm tenantId={tenantId} />
      {rows.length === 0 ? (
        <div className={s.box} role="status" data-state="empty">
          <p className={s.boxText}>Belum ada catatan aksi vendor pada cakupan ini.</p>
        </div>
      ) : (
        <div className={s.tableWrap} role="region" aria-label="Log audit vendor" tabIndex={0}>
          <table className={s.table}>
            <caption className="sr-only">Log audit vendor</caption>
            <thead>
              <tr>
                <th scope="col">Waktu</th>
                <th scope="col">Peran</th>
                <th scope="col">Aksi</th>
                <th scope="col">Klinik</th>
                <th scope="col">Hasil</th>
                <th scope="col">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.at)}</td>
                  <td>{r.actorRole ?? "—"}</td>
                  <td>
                    {r.action}
                    {r.reasonCode ? <p className={s.help}>{r.reasonCode}</p> : null}
                  </td>
                  <td>
                    {r.tenantId ? (
                      <Link prefetch={false} className={s.cardLink} href={`${HREF}?tenant=${r.tenantId}`}>
                        {r.tenantName ?? r.tenantId}
                      </Link>
                    ) : (
                      "Platform"
                    )}
                  </td>
                  <td>
                    <span className={`${s.badge} ${r.outcome === "success" ? s.toneSuccess : s.toneWarning}`}>
                      {r.outcome === "success" ? "Berhasil" : "Ditolak"}
                    </span>
                  </td>
                  <td>{r.clientIp ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>,
  );
}
