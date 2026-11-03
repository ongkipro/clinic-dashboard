// Vendor console shell (UI-17, 19 §3). Sidebar with the console pages that exist so far;
// pages a role cannot use are absent (NAV-1). The rest of the 19 §3 tree arrives with
// its tasks (T-023 tenant detail, T-024 onboarding, T-118 health, T-129 full tree).
// Tenant-controlled strings are rendered as React text only (escaped), never as markup.
import { Building2 } from "lucide-react";
import Link from "next/link";
import type { ConsoleUser, VendorRole } from "./server";
import { VendorSignOut } from "./sign-out";
import s from "./console.module.css";

export const VENDOR_ROLE_LABEL: Record<VendorRole, string> = {
  platform_owner: "Pemilik Platform",
  onboarding: "Onboarding",
  support: "Dukungan",
  vendor_finance: "Keuangan Vendor",
  vendor_auditor: "Auditor Vendor",
};

const PAGES = [{ href: "/vendor/tenant", label: "Tenant", icon: Building2, roles: "all" as const }];

export function ConsoleShell({ user, current, children }: { user: ConsoleUser; current: string; children: React.ReactNode }) {
  return (
    <div className={s.shell}>
      <a className={s.skip} href="#isi">
        Lewati ke isi
      </a>
      <nav className={s.sidebar} aria-label="Konsol Vendor">
        <p className={s.product}>Konsol Vendor</p>
        <ul className={s.nav}>
          {PAGES.map((p) => (
            <li key={p.href}>
              <Link className={s.navLink} href={p.href} aria-current={current === p.href ? "page" : undefined} prefetch={false}>
                <p.icon aria-hidden="true" strokeWidth={1.75} />
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className={s.who}>
          <p className={s.whoName}>{user.name}</p>
          <p className={s.whoRoles}>{user.roles.map((r) => VENDOR_ROLE_LABEL[r]).join(" · ")}</p>
          <VendorSignOut />
        </div>
      </nav>
      <main id="isi" tabIndex={-1} className={s.content}>
        {children}
      </main>
    </div>
  );
}

// Why the console is closed (vendor_guard refusal). The specific reasons reach only vendor
// staff (vendor_console_guard checks staff membership first); everyone else sees the
// generic copy, which does not say whether the account is vendor staff.
export function RefusedScreen({ reason }: { reason: string }) {
  const copy: Record<string, [string, string]> = {
    ip_not_allowed: ["Alamat jaringan ini tidak diizinkan", "Buka Konsol Vendor dari jaringan kantor vendor, atau minta Pemilik Platform menambahkan alamatnya"],
    totp_not_verified: ["Verifikasi dua langkah sudah kedaluwarsa", "Masuk kembali untuk memverifikasi ulang"],
    vendor_staff_inactive: ["Akses vendor Anda tidak aktif", "Pemilik Platform dapat mengaktifkannya kembali"],
  };
  const [title, body] = copy[reason] ?? ["Akun ini tidak memiliki akses ke Konsol Vendor", "Pemilik Platform dapat menambahkan Anda ke Tim Vendor"];
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <p className={s.eyebrow}>Konsol Vendor</p>
        <h1 className={s.title}>Akses ditolak</h1>
        <div className={s.box} role="status">
          <p className={s.boxText}>
            <strong>{title}.</strong> {body}.
          </p>
          <VendorSignOut />
        </div>
      </div>
    </main>
  );
}
