// Konsol Vendor › Feature Flag Platform (UX-40 ▸ Flag, 19 §3, ADR-7; T-129 + HYG-024).
// Platform owner only; reads platform_feature_flags + tenant_feature_flags (Release 1 ships empty catalogue, writes closed).
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { listFeatureFlags } from "../../../modules/vendor/console/console";
import { consoleGate, vendorPool } from "../_lib/server";
import { ConsoleShell, mayOpen, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";
import s from "../_lib/console.module.css";

const HREF = "/vendor/flag";
const TITLE = "Feature Flag Platform";
const LEAD = "Fitur khusus tender per klinik (ADR-7). Penulisan ditutup pada Rilis 1.";

export default async function FlagPage({ searchParams }: { searchParams: Promise<{ tenant?: string | string[] }> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const shell = (body: React.ReactNode) => <ConsoleShell user={gate.user} current={HREF}>{body}</ConsoleShell>;
  if (!mayOpen(gate.user.roles, HREF)) return shell(<PermissionState title={TITLE} />);
  if (tenantParam((await searchParams).tenant).kind === "invalid") notFound();

  let res;
  try {
    res = await listFeatureFlags(await vendorPool(), gate.caller);
  } catch (e) {
    console.error("vendor/flag: read failed", (e as { code?: string }).code ?? "unknown");
    res = { ok: false as const, code: "ERR_INTERNAL", reason: "read_error" };
  }
  if (!res.ok) {
    if (res.reason === "role_not_held") return shell(<PermissionState title={TITLE} />);
    return shell(
      <div className={s.page}>
        <h1 className={s.title}>{TITLE}</h1>
        <p className={s.lead}>{LEAD}</p>
        <div className={s.box} role="alert" data-state="error">
          <p className={s.boxText}>Katalog feature flag belum dapat dimuat.</p>
          <Link prefetch={false} href={HREF} className={s.plain}>
            Coba Lagi
          </Link>
        </div>
      </div>,
    );
  }

  const { catalogue } = res.data;
  return shell(
    <div className={s.page}>
      <h1 className={s.title}>{TITLE}</h1>
      <p className={s.lead}>{LEAD}</p>
      {catalogue.length === 0 ? (
        <div className={s.box} role="status" data-state="empty">
          <p className={s.boxText}>Belum ada fitur khusus tender.</p>
          <p className={s.boxMuted}>
            Rilis 1 tidak memiliki fitur khusus tender, sehingga belum ada yang dapat diaktifkan dari halaman ini.
          </p>
        </div>
      ) : (
        <div className={s.tableWrap} role="region" aria-label="Katalog feature flag" tabIndex={0}>
          <table className={s.table}>
            <caption className="sr-only">Katalog feature flag</caption>
            <thead>
              <tr>
                <th scope="col">Kunci</th>
                <th scope="col">Label</th>
                <th scope="col">Referensi Tender</th>
              </tr>
            </thead>
            <tbody>
              {catalogue.map((f) => (
                <tr key={f.key}>
                  <th scope="row">{f.key}</th>
                  <td>
                    {f.label}
                    <p className={s.help}>{f.description}</p>
                  </td>
                  <td>{f.tenderRef}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>,
  );
}
