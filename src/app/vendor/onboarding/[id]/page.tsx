// Konsol Vendor › Onboarding › Ceklis (UX-41, PR-59): the checklist per tenant and per branch with
// owner, status and blocker; the go-live blockers the database reports; Tandai Siap Live (platform
// owner) enabled only when nothing blocks. Platform page: item keys, vendor notes and vendor staff
// names only (vendor_console_checklist); tenant names are React text (SEC-21).
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { checklist } from "../../../../modules/vendor/checklist/checklist";
import { blockerLabel } from "../../../../modules/vendor/checklist/labels";
import { consoleGate, vendorPool } from "../../_lib/server";
import { ConsoleShell, RefusedScreen } from "../../_lib/shell";
import { STATE, type State } from "../../tenant/tenant-list";
import { ChecklistEditor, GoLive } from "./checklist-actions";
import s from "../../_lib/console.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const when = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const r = await checklist(await vendorPool(), gate.caller, id);
  if (!r.ok && r.code === "ERR_NOT_FOUND") notFound();
  if (!r.ok) throw new Error("vendor_console_checklist refused");
  const t = r.data;
  const roles = t.my_roles ?? [];
  const editable = t.state === "onboarding" && (roles.includes("onboarding") || roles.includes("platform_owner"));
  const state = STATE[t.state as State];
  const tenantItems = t.items.filter((i) => !i.branch_id);
  const branches = [...new Map(t.items.filter((i) => i.branch_id).map((i) => [i.branch_id!, i])).values()];
  return (
    <ConsoleShell user={gate.user} current="/vendor/onboarding">
      <div className={`${s.page} ${s.narrow}`}>
        <Link prefetch={false} className={`${s.plain} ${s.back}`} href="/vendor/onboarding">
          ‹ Onboarding
        </Link>
        <div className={s.header}>
          <h1 className={s.title}>{t.name ?? "Belum ada nama badan usaha"}</h1>
          <span className={`${s.badge} ${state.tone}`}>{state.label}</span>
        </div>
        {t.items.length === 0 ? (
          <div className={s.box} role="status">
            <p className={s.boxText}>Ceklis onboarding belum ada.</p>
            <p className={s.boxMuted}>Ceklis dibuat saat klinik masuk onboarding (Mulai Onboarding di halaman Tenant).</p>
          </div>
        ) : (
          <>
            <section className={s.section} aria-labelledby="golive">
              <h2 id="golive" className={s.sectionTitle}>
                Go-live
              </h2>
              {t.go_live_at ? (
                <div className={s.box} role="status">
                  <p className={s.boxText}>
                    <strong>Live sejak {when.format(new Date(t.go_live_at))}.</strong> Tanggal ini menjadi awal tagihan biaya server.
                  </p>
                </div>
              ) : t.blockers.length > 0 ? (
                <div className={s.box}>
                  <p className={s.boxText}>
                    <strong>Belum bisa live.</strong> Selesaikan dulu:
                  </p>
                  <ul className={s.facts} aria-label="Yang masih menghalangi go-live">
                    {t.blockers.map((b) => (
                      <li key={b} className={s.blockerRow}>
                        {blockerLabel(b)}
                      </li>
                    ))}
                  </ul>
                  {roles.includes("platform_owner") && t.state === "onboarding" && <GoLive tenantId={t.id} ready={false} />}
                </div>
              ) : (
                <div className={s.box}>
                  <p className={s.boxText}>
                    <strong>Semua syarat terpenuhi.</strong> Pemilik Platform dapat menandai klinik siap live; tanggalnya menjadi awal tagihan.
                  </p>
                  {roles.includes("platform_owner") && t.state === "onboarding" ? (
                    <GoLive tenantId={t.id} ready />
                  ) : (
                    <p className={s.boxMuted}>Hanya Pemilik Platform yang dapat menandai siap live.</p>
                  )}
                </div>
              )}
            </section>
            <section className={s.section} aria-labelledby="klinik">
              <h2 id="klinik" className={s.sectionTitle}>
                Klinik
              </h2>
              <ChecklistEditor tenantId={t.id} items={tenantItems} staff={t.staff} editable={editable} label="Ceklis klinik" />
            </section>
            {branches.map((b) => (
              <section key={b.branch_id} className={s.section} aria-labelledby={`cabang-${b.branch_code}`}>
                <h2 id={`cabang-${b.branch_code}`} className={s.sectionTitle}>
                  {b.branch_name ?? `Cabang ${b.branch_code}`}
                </h2>
                <ChecklistEditor tenantId={t.id} items={t.items.filter((i) => i.branch_id === b.branch_id)} staff={t.staff} editable={editable} label={`Ceklis cabang ${b.branch_code}`} />
              </section>
            ))}
          </>
        )}
      </div>
    </ConsoleShell>
  );
}
