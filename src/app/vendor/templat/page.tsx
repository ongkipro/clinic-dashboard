// Konsol Vendor › Templat Global (UX-54 vendor scope, 19 §3; T-129 + HYG-024).
// Platform owner only; reads versioned plain-text vendor_legal_templates (WABA system-message templates live in the WABA module).
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { listLegalTemplates } from "../../../modules/vendor/console/console";
import { consoleGate, vendorPool } from "../_lib/server";
import { ConsoleShell, mayOpen, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";
import s from "../_lib/console.module.css";
import { TemplateSaveForm } from "./actions";

const HREF = "/vendor/templat";
const TITLE = "Templat Global";
const LEAD = "Templat teks polos halaman legal situs publik (templat pesan sistem WABA dikelola di modul WABA).";

const KIND_LABEL: Record<string, string> = {
  "kebijakan-privasi": "Kebijakan Privasi",
  "syarat-ketentuan": "Syarat & Ketentuan",
  "kebijakan-pembatalan": "Kebijakan Pembatalan",
};

export default async function TemplatPage({ searchParams }: { searchParams: Promise<{ tenant?: string | string[] }> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const shell = (body: React.ReactNode) => <ConsoleShell user={gate.user} current={HREF}>{body}</ConsoleShell>;
  if (!mayOpen(gate.user.roles, HREF)) return shell(<PermissionState title={TITLE} />);
  if (tenantParam((await searchParams).tenant).kind === "invalid") notFound();

  let res;
  try {
    res = await listLegalTemplates(await vendorPool(), gate.caller);
  } catch (e) {
    console.error("vendor/templat: read failed", (e as { code?: string }).code ?? "unknown");
    res = { ok: false as const, code: "ERR_INTERNAL", reason: "read_error" };
  }
  if (!res.ok) {
    if (res.reason === "role_not_held") return shell(<PermissionState title={TITLE} />);
    return shell(
      <div className={s.page}>
        <h1 className={s.title}>{TITLE}</h1>
        <p className={s.lead}>{LEAD}</p>
        <div className={s.box} role="alert" data-state="error">
          <p className={s.boxText}>Daftar templat global belum dapat dimuat.</p>
          <Link prefetch={false} href={HREF} className={s.plain}>
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
      <TemplateSaveForm />
      {rows.length === 0 ? (
        <div className={s.box} role="status" data-state="empty">
          <p className={s.boxText}>Belum ada versi templat legal global tersimpan.</p>
          <p className={s.boxMuted}>
            Situs publik memakai templat bawaan teks polos hingga versi global disimpan melalui API konsol.
          </p>
        </div>
      ) : (
        <div className={s.tableWrap} role="region" aria-label="Daftar templat legal global" tabIndex={0}>
          <table className={s.table}>
            <caption className="sr-only">Daftar templat legal global</caption>
            <thead>
              <tr>
                <th scope="col">Jenis</th>
                <th scope="col">Versi</th>
                <th scope="col">Status</th>
                <th scope="col">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{KIND_LABEL[r.kind] ?? r.kind}</th>
                  <td>v{r.version}</td>
                  <td>
                    <span className={`${s.badge} ${r.isActive ? s.toneSuccess : s.toneNeutral}`}>
                      {r.isActive ? "Aktif" : "Arsip"}
                    </span>
                  </td>
                  <td>{r.sha256.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>,
  );
}
