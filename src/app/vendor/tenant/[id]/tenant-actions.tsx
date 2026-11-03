"use client";
// What can happen next on a tenant (DEC-033, TEN-12): the first-owner invitation (approve
// by another platform owner → the one-time link; cancel; a new one after expiry or
// cancellation) and Mulai Onboarding once the Owner approved the processor agreement.
// Buttons appear only for roles that may use them; the database decides again.
import { useState } from "react";
import { post } from "../../_lib/post";
import s from "../../_lib/console.module.css";

type Invitation = { id: string; name: string; email: string; state: string; requestedById: string; requestedBy: string; expires: string | null };

export function TenantActions(p: { tenantId: string; state: string; hasOwner: boolean; agreement: boolean; me: string; roles: string[]; invitation: Invitation | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [link, setLink] = useState<string>();
  const owner = p.roles.includes("platform_owner");
  const maker = owner || p.roles.includes("onboarding");

  async function run(action: string, body: unknown, after?: (d: Record<string, unknown>) => void) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const r = await post(action, body);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    if (after) after(r.data);
    else window.location.reload();
  }

  const alert = error && (
    <p className={s.alert} role="alert">
      {error}
    </p>
  );

  // Provisioning: the Owner joins first, then approves the processor agreement.
  if (p.state !== "provisioning") return alert || null;
  const i = p.invitation;

  return (
    <section className={s.section} aria-labelledby="langkah">
      <h2 id="langkah" className={s.sectionTitle}>
        Langkah Berikutnya
      </h2>
      {alert}
      {link && (
        <div className={s.box}>
          <p className={s.notice} role="status">
            Undangan disetujui. Kirim tautan ini ke {i?.email}. Tautan hanya tampil sekali dan berlaku 7 hari.
          </p>
          <p className={s.link} aria-label="Tautan undangan Owner">
            {link}
          </p>
          <button type="button" className={s.plain} onClick={() => navigator.clipboard?.writeText(link)}>
            Salin Tautan
          </button>
        </div>
      )}
      {!p.hasOwner && i && !link && (
        <div className={s.box}>
          <p className={s.boxText}>
            <strong>Undangan Owner untuk {i.name}</strong> ({i.email})
          </p>
          {i.state === "pending" ? (
            <p className={s.boxMuted}>Dibuat oleh {i.requestedBy}. Menunggu persetujuan Pemilik Platform lain.</p>
          ) : (
            <p className={s.boxMuted}>Tautan sudah dikirim. Berlaku sampai {i.expires}.</p>
          )}
          <div className={s.actions}>
            {i.state === "pending" && owner && i.requestedById !== p.me && (
              <button type="button" className={s.primary} aria-disabled={busy} onClick={() => run("owner-invite-approve", { invitationId: i.id }, (d) => setLink(String(d.link)))}>
                Setujui Undangan
              </button>
            )}
            {maker && (
              <button type="button" className={s.danger} aria-disabled={busy} onClick={() => run("owner-invite-cancel", { invitationId: i.id })}>
                Batalkan Undangan
              </button>
            )}
          </div>
        </div>
      )}
      {!p.hasOwner && !i && maker && <NewInvitation tenantId={p.tenantId} busy={busy} run={run} />}
      {p.hasOwner && (
        <div className={s.box}>
          <p className={s.boxText}>
            {p.agreement ? <strong>Owner sudah menyetujui Perjanjian Pengolahan Data.</strong> : <strong>Menunggu Owner mengunggah dan menyetujui Perjanjian Pengolahan Data.</strong>}{" "}
            {p.agreement ? "Onboarding bisa dimulai." : "Onboarding dapat dimulai setelah itu."}
          </p>
          {maker && (
            <OnboardingStart tenantId={p.tenantId} enabled={p.agreement} busy={busy} run={run} />
          )}
        </div>
      )}
    </section>
  );
}

function NewInvitation({ tenantId, busy, run }: { tenantId: string; busy: boolean; run: (a: string, b: unknown) => Promise<void> }) {
  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run("owner-invite", { tenantId, ownerName: String(f.get("ownerName") ?? "").trim(), ownerEmail: String(f.get("ownerEmail") ?? "").trim() });
      }}
    >
      <p className={s.boxText}>
        <strong>Belum ada undangan Owner yang berlaku.</strong> Buat undangan baru; Pemilik Platform lain perlu menyetujuinya.
      </p>
      <div className={s.field}>
        <label className={s.label} htmlFor="ownerName">
          Nama Owner
        </label>
        <input className={s.input} id="ownerName" name="ownerName" maxLength={120} required />
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="ownerEmail">
          Email Owner
        </label>
        <input className={s.input} id="ownerEmail" name="ownerEmail" type="email" maxLength={254} required />
      </div>
      <button type="submit" className={s.primary} aria-disabled={busy}>
        Buat Undangan Owner
      </button>
    </form>
  );
}

function OnboardingStart({ tenantId, enabled, busy, run }: { tenantId: string; enabled: boolean; busy: boolean; run: (a: string, b: unknown) => Promise<void> }) {
  if (!enabled) {
    return (
      <button type="button" className={s.primary} aria-disabled="true">
        Mulai Onboarding
      </button>
    );
  }
  return (
    <form
      className={s.fieldset}
      onSubmit={(e) => {
        e.preventDefault();
        run("tenant-advance", { tenantId, to: "onboarding", reason: String(new FormData(e.currentTarget).get("reason") ?? "").trim() });
      }}
    >
      <div className={s.field}>
        <label className={s.label} htmlFor="reason">
          Catatan
        </label>
        <input className={s.input} id="reason" name="reason" defaultValue="Perjanjian pengolahan data disetujui Owner" minLength={10} maxLength={500} required />
      </div>
      <button type="submit" className={s.primary} aria-disabled={busy}>
        Mulai Onboarding
      </button>
    </form>
  );
}
