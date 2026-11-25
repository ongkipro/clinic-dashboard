// Vendor console shell (UI-17, 19 §3; T-129 vendor UI subset). The sidebar is the 19 §3 tree filtered by role:
// pages a role cannot use are absent, never disabled (NAV-1). VENDOR_NAV is the one list the sidebar, the
// page role gates (mayOpen) and tests/vendor/tree.spec.ts read.
// Tenant-controlled strings are rendered as React text only (escaped), never as markup.
import { Activity, Building2, ClipboardCheck, FileText, Flag, Landmark, LifeBuoy, Plug, Receipt, ScrollText, ShieldCheck, Users } from "lucide-react";
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

export const VENDOR_ROLES = ["platform_owner", "onboarding", "support", "vendor_finance", "vendor_auditor"] as const satisfies readonly VendorRole[];

// One row per 19 §3 page, in its order. `roles` = who sees the sidebar link and may open the page;
// `menu: false` = reached from a record, not from the sidebar (Detail Tenant).
export type VendorNavEntry = { href: string; label: string; icon: typeof Building2; roles: readonly VendorRole[]; menu?: false };
export const VENDOR_NAV: readonly VendorNavEntry[] = [
  { href: "/vendor/tenant", label: "Tenant", icon: Building2, roles: VENDOR_ROLES },
  { href: "/vendor/tenant/[id]", label: "Detail Tenant", icon: Building2, roles: VENDOR_ROLES, menu: false },
  { href: "/vendor/onboarding", label: "Onboarding", icon: ClipboardCheck, roles: ["onboarding", "platform_owner"] },
  { href: "/vendor/integrasi", label: "Integrasi", icon: Plug, roles: ["support"] },
  { href: "/vendor/tagihan", label: "Tagihan Server", icon: Receipt, roles: ["vendor_finance", "platform_owner", "vendor_auditor"] },
  { href: "/vendor/sesi", label: "Sesi Dukungan", icon: LifeBuoy, roles: ["support", "onboarding"] },
  { href: "/vendor/kesehatan", label: "Kesehatan Platform", icon: Activity, roles: ["platform_owner", "support"] },
  { href: "/vendor/tim", label: "Tim Vendor", icon: Users, roles: ["platform_owner"] },
  { href: "/vendor/audit", label: "Audit Vendor", icon: ScrollText, roles: ["platform_owner", "vendor_auditor"] },
  { href: "/vendor/profil", label: "Profil Vendor", icon: Landmark, roles: ["platform_owner"] },
  { href: "/vendor/flag", label: "Feature Flag Platform", icon: Flag, roles: ["platform_owner"] },
  { href: "/vendor/templat", label: "Templat Global", icon: FileText, roles: ["platform_owner"] },
];
// Own account page (DEC-033), not a 19 §3 row: every vendor role, after the tree.
const ACCOUNT = { href: "/vendor/keamanan", label: "Keamanan Akun", icon: ShieldCheck };

const holds = (held: readonly VendorRole[], wanted: readonly VendorRole[]) => wanted.some((r) => held.includes(r));
// The sidebar of a staff member: the 19 §3 pages one of their roles may use, in 19 §3 order.
export const navFor = (roles: readonly VendorRole[]): VendorNavEntry[] => VENDOR_NAV.filter((p) => p.menu !== false && holds(roles, p.roles));
// The page role gate. An href that is not in the tree is never open (fail closed).
export function mayOpen(roles: readonly VendorRole[], href: string): boolean {
  const p = VENDOR_NAV.find((x) => x.href === href);
  return p !== undefined && holds(roles, p.roles);
}

// Optional ?tenant= on a console page: absent, one well-formed tenant id, or invalid. A page answers not-found
// for "invalid"; a malformed or repeated value is never read as "all tenants".
const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type TenantParam = { kind: "none" } | { kind: "tenant"; id: string } | { kind: "invalid" };
export function tenantParam(v: string | string[] | undefined): TenantParam {
  if (v === undefined) return { kind: "none" };
  return typeof v === "string" && TENANT_ID.test(v) ? { kind: "tenant", id: v } : { kind: "invalid" };
}

export function ConsoleShell({ user, current, children }: { user: ConsoleUser; current: string; children: React.ReactNode }) {
  return (
    <div className={s.shell}>
      <a className={s.skip} href="#isi">
        Lewati ke isi
      </a>
      <nav className={s.sidebar} aria-label="Konsol Vendor">
        <p className={s.product}>Konsol Vendor</p>
        <ul className={s.nav}>
          {[...navFor(user.roles), ACCOUNT].map((p) => (
            <li key={p.href}>
              <Link className={s.navLink} href={p.href} aria-current={current === p.href || current.startsWith(`${p.href}/`) ? "page" : undefined} prefetch={false}>
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

// The permission state of a console page (10 State Copy Patterns): the title and one sentence, no data, no link.
export function PermissionState({ title }: { title: string }) {
  return (
    <div className={s.page}>
      <h1 className={s.title}>{title}</h1>
      <div className={s.box} role="status">
        <p className={s.boxText}>Anda tidak memiliki akses ke {title}.</p>
      </div>
    </div>
  );
}

// A 19 §3 page whose reader does not exist yet: says so, shows no figure and offers no action.
export function NotAvailable({ title, lead, why, children }: { title: string; lead: string; why: string; children?: React.ReactNode }) {
  return (
    <div className={s.page}>
      <h1 className={s.title}>{title}</h1>
      <p className={s.lead}>{lead}</p>
      <div className={s.box} role="status" data-state="not_available">
        <p className={s.boxText}>
          <span className={`${s.badge} ${s.toneNeutral}`}>Belum tersedia</span>
        </p>
        <p className={s.boxMuted}>{why}</p>
        {children}
      </div>
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
