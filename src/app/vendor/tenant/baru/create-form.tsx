"use client";
// Buat Tenant form. Field rules mirror vendor_console_tenant_create (the database is the
// authority); messages appear next to the field. No clinic data beyond the contract
// contact of the first Owner (TEN-12, DEC-033).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "../../_lib/post";
import s from "../../_lib/console.module.css";

type Errors = Partial<Record<"legalName" | "branchCode" | "branchName" | "ownerName" | "ownerEmail", string>>;

function check(f: FormData): Errors {
  const e: Errors = {};
  const v = (k: string) => String(f.get(k) ?? "").trim();
  if (v("legalName").length < 3 || v("legalName").length > 160) e.legalName = "Isi nama badan usaha, 3–160 karakter.";
  if (!/^[A-Z0-9]{2,8}$/.test(v("branchCode"))) e.branchCode = "2–8 huruf besar atau angka, misalnya PST.";
  if (v("branchName").length < 2 || v("branchName").length > 120) e.branchName = "Isi nama cabang.";
  if (v("ownerName").length < 2 || v("ownerName").length > 120) e.ownerName = "Isi nama Owner sesuai kontrak.";
  if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(v("ownerEmail"))) e.ownerEmail = "Isi email yang valid.";
  return e;
}

export function CreateTenantForm() {
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const f = new FormData(event.currentTarget);
    const e = check(f);
    setErrors(e);
    setError(undefined);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0];
      document.getElementById(first)?.focus();
      return;
    }
    setBusy(true);
    const r = await post("tenant-create", {
      legalName: String(f.get("legalName")).trim(), sak: f.get("sak"), branchCode: String(f.get("branchCode")).trim(),
      branchName: String(f.get("branchName")).trim(), timezone: f.get("timezone"),
      ownerName: String(f.get("ownerName")).trim(), ownerEmail: String(f.get("ownerEmail")).trim(),
    });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    router.push(`/vendor/tenant/${String(r.data.tenant_id)}`);
  }

  const field = (id: keyof Errors, label: string, input: React.ReactNode, help?: string) => (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      {input}
      {errors[id] ? (
        <p className={s.fieldError} id={`${id}-error`}>
          {errors[id]}
        </p>
      ) : (
        help && <p className={s.help}>{help}</p>
      )}
    </div>
  );
  const attrs = (id: keyof Errors) => ({ id, name: id, className: s.input, "aria-invalid": errors[id] ? true : undefined, "aria-describedby": errors[id] ? `${id}-error` : undefined });

  return (
    <form className={s.form} onSubmit={submit} noValidate>
      {error && (
        <p className={s.alert} role="alert">
          {error}
        </p>
      )}
      <fieldset className={s.fieldset}>
        <legend className={s.legend}>Badan usaha</legend>
        {field("legalName", "Nama badan usaha", <input {...attrs("legalName")} autoComplete="organization" maxLength={160} required />, "Sesuai akta, misalnya PT Klinik Cantik Sejahtera.")}
        <div className={s.field}>
          <label className={s.label} htmlFor="sak">
            Standar akuntansi
          </label>
          <select id="sak" name="sak" className={s.input} defaultValue="emkm">
            <option value="emkm">SAK EMKM</option>
            <option value="ep">SAK EP</option>
          </select>
        </div>
      </fieldset>
      <fieldset className={s.fieldset}>
        <legend className={s.legend}>Cabang pertama</legend>
        <div className={s.row2}>
          {field("branchCode", "Kode cabang", <input {...attrs("branchCode")} autoCapitalize="characters" maxLength={8} required />, "Misalnya PST.")}
          <div className={s.field}>
            <label className={s.label} htmlFor="timezone">
              Zona waktu
            </label>
            <select id="timezone" name="timezone" className={s.input} defaultValue="Asia/Jakarta">
              <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
              <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
              <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
            </select>
          </div>
        </div>
        {field("branchName", "Nama cabang", <input {...attrs("branchName")} maxLength={120} required />)}
      </fieldset>
      <fieldset className={s.fieldset}>
        <legend className={s.legend}>Owner pertama</legend>
        <p className={s.help}>Orang yang menandatangani kontrak. Ia menerima tautan undangan, membuat kata sandi, lalu memasang autentikator.</p>
        {field("ownerName", "Nama lengkap", <input {...attrs("ownerName")} autoComplete="off" maxLength={120} required />)}
        {field("ownerEmail", "Email", <input {...attrs("ownerEmail")} type="email" autoComplete="off" maxLength={254} required />, "Undangan hanya bisa diterima dengan email ini.")}
      </fieldset>
      <div className={s.actions}>
        <button type="submit" className={s.primary} aria-disabled={busy}>
          {busy ? "Membuat…" : "Buat Tenant"}
        </button>
        <Link prefetch={false} className={s.plain} href="/vendor/tenant">
          Batal
        </Link>
      </div>
    </form>
  );
}
