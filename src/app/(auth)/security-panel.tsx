"use client";
// Profil & Keamanan (19 §2.16, DEC-033), shared by the clinic app (/saya/keamanan) and the
// vendor console (/vendor/keamanan): change password, the authenticator (set up, replace
// or turn off, new backup codes) and active sessions. Calls this surface's auth API; ending
// another session goes through `endSession` (a Server Action on the app host, the console
// JSON route on the vendor host). Raw server messages are never shown (client.ts).
import { useState } from "react";
import { EnrolForm } from "./aktifkan-2fa/enrol-form";
import { callAuth } from "./client";
import s from "./auth.module.css";

export type SessionView = { id: string; device: string; ip: string | null; since: string; current: boolean };

type Props = {
  base?: string; // auth API of this surface
  here: string; // this page, to reload after a change
  enrolPath: string; // the enrolment screen for a TOTP-required account
  email: string;
  totpEnabled: boolean;
  totpRequired: boolean;
  sessions: SessionView[];
  endSession: (id: string) => Promise<boolean>;
};

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ok, setOk] = useState<string>();
  async function run(fn: () => Promise<string | undefined | { ok: string }>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setOk(undefined);
    const r = await fn();
    setBusy(false);
    if (typeof r === "string") setError(r);
    else if (r) setOk(r.ok);
  }
  return { busy, error, ok, run };
}

function Alerts({ error, ok }: { error?: string; ok?: string }) {
  return (
    <>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {ok && (
        <p className={s.success} role="status">
          {ok}
        </p>
      )}
    </>
  );
}

function PasswordSection({ base, email }: { base?: string; email: string }) {
  const b = useBusy();
  return (
    <section aria-labelledby="sandi" className={s.section}>
      <h2 id="sandi" className={s.heading}>
        Kata Sandi
      </h2>
      <form
        className={s.group}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          b.run(async () => {
            if (f.get("newPassword") !== f.get("confirm")) return "Kedua kata sandi baru tidak sama.";
            const r = await callAuth("/change-password", { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") }, base);
            if (!r.ok) return r.message;
            form.reset();
            return { ok: "Kata sandi diubah. Sesi di perangkat lain sudah dikeluarkan." };
          });
        }}
      >
        <Alerts error={b.error} ok={b.ok} />
        <input type="email" value={email} readOnly hidden autoComplete="username" />
        <div className={s.field}>
          <label className={s.label} htmlFor="currentPassword">
            Kata sandi sekarang
          </label>
          <input className={s.input} id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="newPassword">
            Kata sandi baru
          </label>
          <input className={s.input} id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={15} maxLength={128} required />
          <p className={s.help}>Minimal 15 karakter. Boleh berupa beberapa kata.</p>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="confirm">
            Ulangi kata sandi baru
          </label>
          <input className={s.input} id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </div>
        <button className={s.primary} type="submit" aria-disabled={b.busy}>
          {b.busy ? "Menyimpan…" : "Ubah Kata Sandi"}
        </button>
      </form>
    </section>
  );
}

function TotpSection({ base, here, enrolPath, totpEnabled, totpRequired }: Omit<Props, "email" | "sessions" | "endSession">) {
  const off = useBusy();
  const codes = useBusy();
  const [backup, setBackup] = useState<string[]>();
  if (!totpEnabled) {
    return (
      <section aria-labelledby="dua-langkah" className={s.section}>
        <h2 id="dua-langkah" className={s.heading}>
          Verifikasi Dua Langkah
        </h2>
        <p className={s.help}>Belum aktif. Pasang aplikasi autentikator agar akun tidak bisa dibuka hanya dengan kata sandi.</p>
        <EnrolForm base={base} home={here} />
      </section>
    );
  }
  return (
    <section aria-labelledby="dua-langkah" className={s.section}>
      <h2 id="dua-langkah" className={s.heading}>
        Verifikasi Dua Langkah
      </h2>
      <p className={s.help}>
        Aktif dengan aplikasi autentikator.{totpRequired ? " Akun Anda wajib memakainya, jadi autentikator hanya bisa diganti, tidak dimatikan." : ""}
      </p>
      <form
        className={s.group}
        aria-label="Kode cadangan baru"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          codes.run(async () => {
            const r = await callAuth("/two-factor/generate-backup-codes", { password: f.get("password") }, base);
            if (!r.ok) return r.message;
            form.reset();
            setBackup((r.data.backupCodes as string[]) ?? []);
            return { ok: "Kode cadangan baru dibuat. Kode lama tidak berlaku lagi." };
          });
        }}
      >
        <Alerts error={codes.error} ok={codes.ok} />
        {backup && (
          <ul className={s.codes} aria-label="Kode cadangan">
            {backup.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        <div className={s.field}>
          <label className={s.label} htmlFor="codesPassword">
            Kata sandi
          </label>
          <input className={s.input} id="codesPassword" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className={s.secondaryButton} type="submit" aria-disabled={codes.busy}>
          {codes.busy ? "Membuat…" : "Buat Kode Cadangan Baru"}
        </button>
      </form>
      <form
        className={s.group}
        aria-label={totpRequired ? "Ganti autentikator" : "Matikan autentikator"}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          off.run(async () => {
            const code = String(f.get("code") ?? "").replace(/\s/g, "");
            const r = await callAuth("/two-factor/disable", { password: f.get("password"), code }, base);
            if (!r.ok) return r.message;
            // The session changed (new cookie): a full load. A required role goes straight
            // to enrolment of the new authenticator.
            window.location.replace(totpRequired ? enrolPath : here);
            return undefined;
          });
        }}
      >
        <Alerts error={off.error} />
        <p className={s.help}>
          {totpRequired
            ? "Untuk ponsel baru: masukkan kata sandi dan kode dari autentikator lama, lalu pasang autentikator baru."
            : "Masukkan kata sandi dan kode dari autentikator untuk mematikannya."}
        </p>
        <div className={s.field}>
          <label className={s.label} htmlFor="offPassword">
            Kata sandi
          </label>
          <input className={s.input} id="offPassword" name="password" type="password" autoComplete="current-password" required />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="offCode">
            Kode 6 digit
          </label>
          <input className={`${s.input} ${s.code}`} id="offCode" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required />
        </div>
        <button className={totpRequired ? s.secondaryButton : s.destructive} type="submit" aria-disabled={off.busy}>
          {off.busy ? "Memeriksa…" : totpRequired ? "Ganti Autentikator" : "Matikan Autentikator"}
        </button>
      </form>
    </section>
  );
}

function SessionsSection({ sessions, endSession }: Pick<Props, "sessions" | "endSession">) {
  const [ended, setEnded] = useState<string[]>([]);
  const b = useBusy();
  const live = sessions.filter((x) => !ended.includes(x.id));
  return (
    <section aria-labelledby="sesi" className={s.section}>
      <h2 id="sesi" className={s.heading}>
        Sesi Aktif
      </h2>
      <Alerts error={b.error} ok={b.ok} />
      <ul className={s.sessions}>
        {live.map((x) => (
          <li key={x.id} className={s.sessionRow}>
            <div className={s.sessionText}>
              <p className={s.sessionTitle}>
                {x.device}
                {x.current && <span className={s.badge}>Perangkat ini</span>}
              </p>
              <p className={s.help}>
                Masuk {x.since}
                {x.ip ? ` · ${x.ip}` : ""}
              </p>
            </div>
            {!x.current && (
              <button
                type="button"
                className={s.destructive}
                aria-disabled={b.busy}
                onClick={() =>
                  b.run(async () => {
                    if (!(await endSession(x.id).catch(() => false))) return "Sesi belum dapat dikeluarkan. Coba Lagi.";
                    setEnded((e) => [...e, x.id]);
                    return { ok: "Sesi dikeluarkan." };
                  })
                }
              >
                Keluarkan
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SecurityPanel(p: Props) {
  return (
    <div className={s.stack}>
      <PasswordSection base={p.base} email={p.email} />
      <TotpSection base={p.base} here={p.here} enrolPath={p.enrolPath} totpEnabled={p.totpEnabled} totpRequired={p.totpRequired} />
      <SessionsSection sessions={p.sessions} endSession={p.endSession} />
    </div>
  );
}
