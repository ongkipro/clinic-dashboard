"use client";
// Tim Vendor body: members (table at regular width, cards at compact), open invitations,
// and the Undang form. Writes go to the console JSON route; the database decides again.
import { useState } from "react";
import { post } from "../_lib/post";
import { VENDOR_ROLE_LABEL } from "../_lib/shell";
import type { VendorRole } from "../_lib/server";
import s from "../_lib/console.module.css";

type Member = { id: string; name: string; email: string; state: "active" | "suspended" | "exited"; totp: boolean; roles: VendorRole[] };
type Invitation = { id: string; name: string; email: string; roles: VendorRole[]; invited_by: string; expires: string };

const ROLES: VendorRole[] = ["platform_owner", "onboarding", "support", "vendor_finance", "vendor_auditor"];
const STATE: Record<Member["state"], { label: string; tone: string }> = {
  active: { label: "Aktif", tone: s.toneSuccess },
  suspended: { label: "Nonaktif", tone: s.toneNeutral },
  exited: { label: "Keluar", tone: s.toneNeutral },
};
const roleList = (roles: VendorRole[]) => roles.map((r) => VENDOR_ROLE_LABEL[r]).join(", ");

export function TeamView({ me, staff, invitations }: { me: string; staff: Member[]; invitations: Invitation[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [link, setLink] = useState<{ url: string; email: string }>();

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

  const action = (m: Member) =>
    m.id === me || m.state === "exited" ? null : m.state === "active" ? (
      <button type="button" className={s.danger} aria-disabled={busy} onClick={() => run("staff-state", { staffId: m.id, state: "suspended" })}>
        Nonaktifkan
      </button>
    ) : (
      <button type="button" className={s.plain} aria-disabled={busy} onClick={() => run("staff-state", { staffId: m.id, state: "active" })}>
        Aktifkan Kembali
      </button>
    );

  return (
    <>
      {error && (
        <p className={s.alert} role="alert">
          {error}
        </p>
      )}
      {link && (
        <div className={s.box}>
          <p className={s.notice} role="status">
            Undangan dibuat. Kirim tautan ini ke {link.email}. Tautan hanya tampil sekali dan berlaku 7 hari.
          </p>
          <p className={s.link} aria-label="Tautan undangan Tim Vendor">
            {link.url}
          </p>
          <div className={s.actions}>
            <button type="button" className={s.plain} onClick={() => navigator.clipboard?.writeText(link.url)}>
              Salin Tautan
            </button>
            <button type="button" className={s.plain} onClick={() => window.location.reload()}>
              Selesai
            </button>
          </div>
        </div>
      )}
      <section className={s.section} aria-labelledby="anggota">
        <h2 id="anggota" className={s.sectionTitle}>
          Anggota
        </h2>
        <div className={s.tableWrap} role="region" aria-label="Anggota Tim Vendor" tabIndex={0}>
          <table className={s.table}>
            <caption className="sr-only">Anggota Tim Vendor</caption>
            <thead>
              <tr>
                <th scope="col">Nama</th>
                <th scope="col">Peran</th>
                <th scope="col">Autentikator</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Tindakan</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {staff.map((m) => (
                <tr key={m.id}>
                  <th scope="row">
                    {m.name}
                    {m.id === me && " (Anda)"}
                    <br />
                    <span className={s.help}>{m.email}</span>
                  </th>
                  <td>{roleList(m.roles)}</td>
                  <td>{m.totp ? "Terpasang" : "Belum dipasang"}</td>
                  <td>
                    <span className={`${s.badge} ${STATE[m.state].tone}`}>{STATE[m.state].label}</span>
                  </td>
                  <td>{action(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className={s.cards} aria-label="Anggota Tim Vendor">
          {staff.map((m) => (
            <li key={m.id} className={s.card}>
              <p className={s.cardTitle}>
                {m.name}
                {m.id === me && " (Anda)"}
              </p>
              <p className={s.help}>{m.email}</p>
              <dl className={s.cardMeta}>
                <dt>Peran</dt>
                <dd>{roleList(m.roles)}</dd>
              </dl>
              <dl className={s.cardMeta}>
                <dt>Autentikator</dt>
                <dd>{m.totp ? "Terpasang" : "Belum dipasang"}</dd>
              </dl>
              <dl className={s.cardMeta}>
                <dt>Status</dt>
                <dd>
                  <span className={`${s.badge} ${STATE[m.state].tone}`}>{STATE[m.state].label}</span>
                </dd>
              </dl>
              {action(m)}
            </li>
          ))}
        </ul>
      </section>
      {invitations.length > 0 && (
        <section className={s.section} aria-labelledby="undangan">
          <h2 id="undangan" className={s.sectionTitle}>
            Undangan Terbuka
          </h2>
          <ul className={s.cards + " " + s.cardsAlways} aria-label="Undangan terbuka">
            {invitations.map((i) => (
              <li key={i.id} className={s.card}>
                <p className={s.cardTitle}>{i.name}</p>
                <p className={s.help}>
                  {i.email} · {roleList(i.roles)} · oleh {i.invited_by} · berlaku sampai {i.expires}
                </p>
                <button type="button" className={s.danger} aria-disabled={busy} onClick={() => run("staff-invite-cancel", { invitationId: i.id })}>
                  Batalkan Undangan
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={`${s.section} ${s.narrow}`} aria-labelledby="undang">
        <h2 id="undang" className={s.sectionTitle}>
          Undang Anggota
        </h2>
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const roles = f.getAll("roles").map(String);
            if (roles.length === 0) return setError("Pilih minimal satu peran.");
            const email = String(f.get("email") ?? "").trim();
            run("staff-invite", { name: String(f.get("name") ?? "").trim(), email, roles }, (d) => setLink({ url: String(d.link), email }));
          }}
        >
          <div className={s.field}>
            <label className={s.label} htmlFor="name">
              Nama lengkap
            </label>
            <input className={s.input} id="name" name="name" maxLength={120} required autoComplete="off" />
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="email">
              Email
            </label>
            <input className={s.input} id="email" name="email" type="email" maxLength={254} required autoComplete="off" />
            <p className={s.help}>Undangan hanya bisa diterima dengan email ini.</p>
          </div>
          <fieldset className={s.fieldset}>
            <legend className={s.label}>Peran</legend>
            {ROLES.map((r) => (
              <label key={r} className={s.check}>
                <input type="checkbox" name="roles" value={r} />
                {VENDOR_ROLE_LABEL[r]}
              </label>
            ))}
          </fieldset>
          <button type="submit" className={s.primary} aria-disabled={busy}>
            {busy ? "Membuat…" : "Buat Undangan"}
          </button>
        </form>
      </section>
    </>
  );
}
