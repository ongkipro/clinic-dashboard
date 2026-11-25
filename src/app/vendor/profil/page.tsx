// Konsol Vendor › Profil Vendor (UX-34, 19 §3; T-129 + HYG-024). Platform owner only; reads canonical vendor_profile + T-120 vendor_go_live_blockers().
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readVendorProfile } from "../../../modules/vendor/console/console";
import { consoleGate, vendorPool } from "../_lib/server";
import { ConsoleShell, mayOpen, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";
import s from "../_lib/console.module.css";

const HREF = "/vendor/profil";
const TITLE = "Profil Vendor";
const LEAD = "Badan usaha, NIB, PSE, NPWP, lokasi data, pendapat hukum, dan penghalang go-live produksi.";

export default async function ProfilPage({ searchParams }: { searchParams: Promise<{ tenant?: string | string[] }> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const shell = (body: React.ReactNode) => <ConsoleShell user={gate.user} current={HREF}>{body}</ConsoleShell>;
  if (!mayOpen(gate.user.roles, HREF)) return shell(<PermissionState title={TITLE} />);
  if (tenantParam((await searchParams).tenant).kind === "invalid") notFound();

  let res;
  try {
    res = await readVendorProfile(await vendorPool(), gate.caller);
  } catch (e) {
    console.error("vendor/profil: read failed", (e as { code?: string }).code ?? "unknown");
    res = { ok: false as const, code: "ERR_INTERNAL", reason: "read_error" };
  }
  if (!res.ok) {
    if (res.reason === "role_not_held") return shell(<PermissionState title={TITLE} />);
    return shell(
      <div className={s.page}>
        <h1 className={s.title}>{TITLE}</h1>
        <p className={s.lead}>{LEAD}</p>
        <div className={s.box} role="alert" data-state="error">
          <p className={s.boxText}>Profil vendor belum dapat dimuat.</p>
          <Link prefetch={false} href={HREF} className={s.plain}>
            Coba Lagi
          </Link>
        </div>
      </div>,
    );
  }

  const { profile, goLiveBlockers } = res.data;
  const placeholders = new Set(profile.placeholderFields);
  const mark = (field: string, value: string) => (placeholders.has(field) ? `${value} (contoh, belum diisi)` : value);

  return shell(
    <div className={s.page}>
      <h1 className={s.title}>{TITLE}</h1>
      <p className={s.lead}>{LEAD}</p>
      <div className={s.box}>
        <dl className={s.cardMeta}>
          <dt>Badan usaha</dt>
          <dd>{mark("legal_name", profile.legalName)}</dd>
          <dt>NIB</dt>
          <dd>{mark("nib", profile.nib)}</dd>
          <dt>PSE</dt>
          <dd>{mark("pse_number", profile.pseNumber)}</dd>
          <dt>NPWP</dt>
          <dd>{mark("npwp", profile.npwp)}</dd>
          <dt>Situs & Privasi</dt>
          <dd>
            {mark("website", profile.website)} · {mark("privacy_url", profile.privacyUrl)}
          </dd>
          <dt>Kontak dukungan</dt>
          <dd>
            {mark("support_email", profile.supportEmail)} · {mark("support_phone", profile.supportPhone)}
          </dd>
          <dt>Status PKP</dt>
          <dd>{profile.isPkp ? `PKP sejak ${profile.pkpEffectiveFrom ?? "—"}` : "Non-PKP"}</dd>
          <dt>Pendapat hukum residensi</dt>
          <dd>
            {profile.residencyOpinionOutcome
              ? `${profile.residencyOpinionOutcome} (${profile.residencyOpinionDate ?? "—"} · ${profile.residencyOpinionRef ?? "—"})`
              : "Belum ditetapkan"}
          </dd>
        </dl>
      </div>
      <div className={s.box}>
        <h2 className={s.sectionTitle}>Lokasi Penyimpanan Data</h2>
        {profile.storageLocations.length === 0 ? (
          <p className={s.boxMuted}>Belum ada lokasi penyimpanan tercatat.</p>
        ) : (
          <dl className={s.facts}>
            {profile.storageLocations.map((loc) => (
              <div key={`${loc.kind}-${loc.provider}-${loc.region}`}>
                <dt>{loc.kind}</dt>
                <dd>{`${loc.provider} · ${loc.region} (${loc.country})`}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className={s.box} role="status">
        <p className={s.boxText}>
          Gerbang Go-Live Produksi:{" "}
          <span className={`${s.badge} ${goLiveBlockers.length === 0 ? s.toneSuccess : s.toneWarning}`}>
            {goLiveBlockers.length === 0 ? "Terbuka" : `${goLiveBlockers.length} penghalang`}
          </span>
        </p>
        {goLiveBlockers.length > 0 ? (
          <p className={s.boxMuted}>{goLiveBlockers.join(" · ")}</p>
        ) : (
          <p className={s.boxMuted}>Seluruh prasyarat profil vendor dan residensi terpenuhi.</p>
        )}
        <Link prefetch={false} href="/vendor/onboarding" className={s.plain}>
          Buka Onboarding
        </Link>
      </div>
    </div>,
  );
}
