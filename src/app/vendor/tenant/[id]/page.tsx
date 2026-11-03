// Konsol Vendor › Tenant › Detail › Ringkasan (UX-40, PR-1, DEC-033): lifecycle state,
// legal entity, branches, whether the clinic has an Owner, the processor agreement, the
// first-owner invitation and the lifecycle history. No patient, staff or clinical data
// (PR-60). Tenant-controlled strings are React text only.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tenantDetail } from "../../../../modules/vendor/tenants/tenants";
import { consoleGate, vendorPool } from "../../_lib/server";
import { ConsoleShell, RefusedScreen } from "../../_lib/shell";
import { STATE, type State } from "../tenant-list";
import { TenantActions } from "./tenant-actions";
import s from "../../_lib/console.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const when = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });
const ZONE: Record<string, string> = { "Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT" };

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const r = await tenantDetail(await vendorPool(), gate.caller, id);
  if (!r.ok && r.code === "ERR_NOT_FOUND") notFound();
  if (!r.ok) throw new Error("vendor_console_tenant_detail refused");
  const t = r.data;
  const state = STATE[t.state as State];
  const open = t.invitations.find((i) => i.state === "pending" || i.state === "issued");
  return (
    <ConsoleShell user={gate.user} current="/vendor/tenant">
      <div className={`${s.page} ${s.narrow}`}>
        <Link prefetch={false} className={`${s.plain} ${s.back}`} href="/vendor/tenant">
          ‹ Tenant
        </Link>
        <div className={s.header}>
          <h1 className={s.title}>{t.name ?? "Belum ada nama badan usaha"}</h1>
          <span className={`${s.badge} ${state.tone}`}>{state.label}</span>
        </div>
        <TenantActions
          tenantId={t.id}
          state={t.state}
          hasOwner={t.has_owner}
          agreement={t.processor_agreement}
          me={t.me}
          roles={t.my_roles}
          invitation={open ? { id: open.id, name: open.name, email: open.email, state: open.state, requestedById: open.requested_by_id, requestedBy: open.requested_by, expires: open.expires_at ? when.format(new Date(open.expires_at)) : null } : null}
        />
        <section className={s.section} aria-labelledby="ringkasan">
          <h2 id="ringkasan" className={s.sectionTitle}>
            Ringkasan
          </h2>
          <dl className={s.facts}>
            <div>
              <dt>Standar akuntansi</dt>
              <dd>{t.sak === "ep" ? "SAK EP" : "SAK EMKM"}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{t.has_owner ? "Sudah bergabung" : "Belum ada"}</dd>
            </div>
            <div>
              <dt>Perjanjian Pengolahan Data</dt>
              <dd>{t.processor_agreement ? "Disetujui Owner" : "Belum disetujui"}</dd>
            </div>
            {t.branches.map((b) => (
              <div key={b.code}>
                <dt>Cabang {b.code}</dt>
                <dd>
                  {b.name} · {ZONE[b.timezone] ?? b.timezone}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        {t.history.length > 0 && (
          <section className={s.section} aria-labelledby="riwayat">
            <h2 id="riwayat" className={s.sectionTitle}>
              Riwayat Status
            </h2>
            <dl className={s.facts}>
              {t.history.map((h, i) => (
                <div key={i}>
                  <dt>{when.format(new Date(h.at))}</dt>
                  <dd>
                    {STATE[h.from as State]?.label ?? h.from} → {STATE[h.to as State]?.label ?? h.to} · {h.reason}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </ConsoleShell>
  );
}
