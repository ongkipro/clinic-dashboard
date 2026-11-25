// Konsol Vendor › Integrasi (UX-42, 19 §3; T-129 + HYG-024). Support only; closed error vocabulary, zero phone digits or patient IDs.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readIntegrations, type CodeCount } from "../../../modules/vendor/console/console";
import { consoleGate, vendorPool } from "../_lib/server";
import { ConsoleShell, mayOpen, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";
import s from "../_lib/console.module.css";

const HREF = "/vendor/integrasi";
const TITLE = "Integrasi";
const LEAD = "Status WABA, SATUSEHAT (kode kategori tertutup), dan webhook pembayaran per klinik.";

const formatCodes = (codes: readonly CodeCount[]) =>
  codes.length === 0 ? "Tidak ada" : codes.map((c) => `${c.code} (${c.count})`).join(", ");

export default async function IntegrasiPage({ searchParams }: { searchParams: Promise<{ tenant?: string | string[] }> }) {
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
    res = await readIntegrations(await vendorPool(), gate.caller, tenantId);
  } catch (e) {
    console.error("vendor/integrasi: read failed", (e as { code?: string }).code ?? "unknown");
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
          <p className={s.boxText}>Status integrasi belum dapat dimuat.</p>
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
      {rows.length === 0 ? (
        <div className={s.box} role="status" data-state="empty">
          <p className={s.boxText}>Belum ada klinik terdaftar untuk pemantauan integrasi.</p>
        </div>
      ) : (
        <div className={s.tableWrap} role="region" aria-label="Status integrasi per klinik" tabIndex={0}>
          <table className={s.table}>
            <caption className="sr-only">Status integrasi per klinik</caption>
            <thead>
              <tr>
                <th scope="col">Klinik</th>
                <th scope="col">WABA</th>
                <th scope="col">SATUSEHAT</th>
                <th scope="col">Webhook Pembayaran</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenantId} data-tenant={r.tenantId}>
                  <th scope="row">
                    <Link prefetch={false} className={s.cardLink} href={`${HREF}?tenant=${r.tenantId}`}>
                      {r.legalName ?? "Belum ada nama badan usaha"}
                    </Link>
                  </th>
                  <td>
                    {r.whatsapp.activeAccounts}/{r.whatsapp.accountsCount} aktif · gagal 24j: {r.whatsapp.failed24h}
                    <p className={s.help}>Kode: {formatCodes(r.whatsapp.codes)}</p>
                  </td>
                  <td>
                    Antrean: {r.satusehat.queued} · gagal 24j: {r.satusehat.failed24h}
                    <p className={s.help}>Kode: {formatCodes(r.satusehat.codes)}</p>
                  </td>
                  <td>
                    Ditolak 24j: {r.payments.rejected24h}
                    <p className={s.help}>Kode: {formatCodes(r.payments.codes)}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>,
  );
}
