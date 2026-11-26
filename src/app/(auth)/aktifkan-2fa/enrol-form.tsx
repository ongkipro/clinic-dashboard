"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { callAuth } from "../client";
import { qrToSvgPath, type QrSvg } from "./qr";
import s from "../auth.module.css";

type Setup = { uri: string; secret: string; backupCodes: string[]; qr?: QrSvg };
type CopyKind = "secret" | "codes";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy selection copy when clipboard permission is unavailable.
  }
  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let el: HTMLTextAreaElement | null = null;
  try {
    el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.className = s.srOnly;
    document.body.appendChild(el);
    el.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    if (el) {
      el.value = "";
      el.remove();
    }
    prevFocus?.focus();
  }
}

// IAM-1 / PR-3: enrol an authenticator app. Step 1 re-checks the password and returns
// the otpauth URI and backup codes; step 2 shows a scannable inline SVG QR code plus
// the copyable manual secret, then confirms one code to mark the factor verified.
export function EnrolForm({ base, home = "/" }: { base?: string; home?: string }) {
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<CopyKind>();
  const [copyNote, setCopyNote] = useState<string>();
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  async function handleCopy(kind: CopyKind, text: string) {
    clearTimeout(copyTimer.current);
    const ok = await copyText(text);
    if (!ok) {
      setCopied(undefined);
      setCopyNote("Gagal menyalin otomatis. Pilih teks lalu salin secara manual.");
      return;
    }
    setCopied(kind);
    setCopyNote(kind === "secret" ? "Kunci autentikator disalin." : "Semua kode cadangan disalin.");
    copyTimer.current = setTimeout(() => setCopied(undefined), 2000);
  }

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const r = await callAuth("/two-factor/enable", {
      password: String(new FormData(event.currentTarget).get("password") ?? ""),
    }, base);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    const rawUri = String(r.data.totpURI ?? "");
    let uri = "";
    let secret = "";
    try {
      const parsed = new URL(rawUri);
      if (parsed.protocol === "otpauth:") {
        uri = rawUri;
        secret = parsed.searchParams.get("secret") ?? "";
      }
    } catch {
      // Malformed URI from auth server: fail safely instead of crashing the client.
    }
    if (!uri || !secret) {
      return setError("Gagal membuat kunci autentikator. Coba lagi.");
    }
    setSetup({
      uri,
      secret,
      backupCodes: (r.data.backupCodes as string[]) ?? [],
      qr: qrToSvgPath(uri),
    });
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const r = await callAuth("/two-factor/verify-totp", { code }, base);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    // The session just changed: a full load, so no page cached by the client router under
    // the previous session (e.g. a redirect to enrolment) is reused.
    window.location.replace(home);
  }

  const alert = error && (
    <p className={s.error} role="alert">
      {error}
    </p>
  );

  if (!setup) {
    return (
      <form className={s.group} onSubmit={start}>
        {alert}
        <div className={s.field}>
          <label className={s.label} htmlFor="password">
            Kata sandi
          </label>
          <input className={s.input} id="password" name="password" type="password" autoComplete="current-password" required />
          <p className={s.help}>Masukkan ulang kata sandi untuk memulai.</p>
        </div>
        <button className={s.primary} type="submit" aria-disabled={busy}>
          {busy ? "Memeriksa…" : "Lanjut"}
        </button>
      </form>
    );
  }

  return (
    <form className={s.group} onSubmit={confirm}>
      {alert}
      <div className={s.field}>
        <span className={s.label}>1. Pindai kode QR atau masukkan kunci manual</span>
        <p className={s.help}>Pindai dengan Google Authenticator, Apple Passwords, atau aplikasi autentikator lain.</p>
        {setup.qr && (
          <div className={s.qrFrame}>
            <svg
              className={s.qr}
              viewBox={`0 0 ${setup.qr.size} ${setup.qr.size}`}
              role="img"
              aria-label="Kode QR autentikator"
              shapeRendering="crispEdges"
            >
              <rect width={setup.qr.size} height={setup.qr.size} fill="#fff" />
              <path d={setup.qr.path} fill="#000" />
            </svg>
          </div>
        )}
        <a className={s.secondary} href={setup.uri}>
          Buka aplikasi autentikator
        </a>
        <p className={s.help}>Atau salin dan ketik kunci ini secara manual:</p>
        <div className={s.secretRow}>
          <p className={s.secret} aria-label="Kunci autentikator">
            {setup.secret}
          </p>
          <button
            type="button"
            className={s.copyButton}
            aria-label="Salin kunci manual"
            onClick={() => handleCopy("secret", setup.secret)}
          >
            {copied === "secret" ? <Check size={16} strokeWidth={1.75} aria-hidden="true" /> : <Copy size={16} strokeWidth={1.75} aria-hidden="true" />}
            <span>{copied === "secret" ? "Tersalin" : "Salin"}</span>
          </button>
        </div>
      </div>
      <div className={s.field}>
        <span className={s.label}>2. Simpan kode cadangan</span>
        <ul className={s.codes} aria-label="Kode cadangan">
          {setup.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        {setup.backupCodes.length > 0 && (
          <button
            type="button"
            className={s.copyButton}
            aria-label="Salin semua kode"
            onClick={() => handleCopy("codes", setup.backupCodes.join("\n"))}
          >
            {copied === "codes" ? <Check size={16} strokeWidth={1.75} aria-hidden="true" /> : <Copy size={16} strokeWidth={1.75} aria-hidden="true" />}
            <span>{copied === "codes" ? "Kode tersalin" : "Salin semua kode"}</span>
          </button>
        )}
        <p className={s.help}>Simpan di tempat aman. Setiap kode hanya bisa dipakai sekali.</p>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="code">
          3. Masukkan kode 6 digit
        </label>
        <input className={`${s.input} ${s.code}`} id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required />
      </div>
      <span className={s.srOnly} role="status" aria-live="polite">
        {copyNote ?? ""}
      </span>
      <button className={s.primary} type="submit" aria-disabled={busy}>
        {busy ? "Memeriksa…" : "Aktifkan"}
      </button>
    </form>
  );
}
