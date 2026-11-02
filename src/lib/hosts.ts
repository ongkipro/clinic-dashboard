// Host resolver (ARCH-3, ARCH-11, ARCH-12, SEC-21, API-1). Each environment has three
// hostnames from configuration (ARCH-9): APP_HOST (staff, clinical, staff API, Meta
// webhooks; DNS-only), BOOKING_HOST (public site, booking, OTP, payment webhooks;
// Cloudflare-proxied) and VENDOR_HOST (vendor console). Every host serves only the path
// prefixes listed for it; any other path, and any unknown host, is refused. Allow-lists
// fail closed: a new staff page is never reachable on the booking host by accident.

export type HostKind = "app" | "booking" | "vendor";
export type HostConfig = Record<HostKind, string>;

// Framework assets every host needs. Nothing tenant-specific is served here.
const SHARED = ["/_next/static/", "/favicon.ico"];

// Clinic pages are served at the app host root with no URL prefix (15 §3), so the app
// host refuses the other hosts' paths and allows the rest.
const BOOKING_PREFIXES = ["/aftercare/", "/api/v1/public/", "/api/v1/webhooks/payment"];
const VENDOR_PREFIXES = ["/vendor", "/api/v1/vendor/"];

// Public site pages live at /{slug}/... on the booking host (17 §UX-51 route map). A slug
// is lower-case letters, digits and hyphens; only the listed public pages follow it.
const PUBLIC_PAGES = [
  "perawatan",
  "cabang",
  "dokter",
  "booking",
  "kebijakan-privasi",
  "syarat-ketentuan",
  "kebijakan-pembatalan",
];
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const DETAIL = /^[a-z0-9][a-z0-9-]{0,127}$/;
const DETAIL_PAGES = new Set(["perawatan", "cabang", "dokter"]);

// Clinic-app top-level segments (19 §2 menu tree and TASKS route folders). A tenant slug
// may never equal one of them, so /{slug} on the booking host cannot shadow a staff page.
export const RESERVED_SEGMENTS = new Set([
  "aftercare", "antrean", "api", "apotek", "audit", "ekspor", "hari-ini", "jadwal",
  "jadwal-staf", "kampanye", "kasir", "katalog", "keluhan", "kepatuhan", "keuangan",
  "komisi", "laporan", "layanan", "lead", "logbook", "masuk", "otomasi", "pasien",
  "pasienku", "pembelian", "pemeriksaan", "pendampingan", "pengaturan", "pengguna-akses",
  "permintaan", "persetujuan", "persetujuan-tindakan", "pesan", "piutang", "privasi",
  "ringkasan", "ruang", "satusehat", "saya", "simulasi", "situs", "staf", "stok",
  "templat", "vendor", "verifikasi", "terkunci", "aktifkan-2fa", "dev",
]);

export function isPublicSitePath(path: string): boolean {
  const seg = path.split("/").slice(1);
  if (seg.at(-1) === "") seg.pop(); // trailing slash
  const [slug, page, detail, ...rest] = seg;
  if (!slug || !SLUG.test(slug) || RESERVED_SEGMENTS.has(slug) || rest.length > 0) return false;
  if (page === undefined) return true;
  if (!PUBLIC_PAGES.includes(page)) return false;
  if (detail === undefined) return true;
  return DETAIL_PAGES.has(page) && DETAIL.test(detail);
}

export type Decision = { allow: true; host: HostKind } | { allow: false; reason: string };

// "/x" matches /x and /x/...; "/x/" matches only /x/... (a subtree with no index page).
function matches(path: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return path.startsWith(prefix) && path.length > prefix.length;
  return path === prefix || path.startsWith(`${prefix}/`);
}

const any = (path: string, prefixes: readonly string[]) => prefixes.some((p) => matches(path, p));

export type HostEnv = { APP_HOST?: string; BOOKING_HOST?: string; VENDOR_HOST?: string };

export function hostConfigFromEnv(env: HostEnv | NodeJS.ProcessEnv): HostConfig {
  const cfg = { app: env.APP_HOST, booking: env.BOOKING_HOST, vendor: env.VENDOR_HOST };
  for (const [k, v] of Object.entries(cfg)) {
    if (!v || !/^[a-z0-9.-]+(:[0-9]{1,5})?$/.test(v)) {
      throw new Error(`${k.toUpperCase()}_HOST must be a lower-case host[:port]`);
    }
  }
  const values = Object.values(cfg);
  if (new Set(values).size !== values.length) throw new Error("app, booking and vendor hosts must differ");
  return cfg as HostConfig;
}

export function hostKind(cfg: HostConfig, host: string | null): HostKind | undefined {
  if (!host) return undefined;
  const h = host.toLowerCase();
  return (Object.keys(cfg) as HostKind[]).find((k) => cfg[k] === h);
}

// Next.js matches routes against the percent-decoded path, so the policy must see the
// same path. Decodes once and refuses anything that is not canonical afterwards: encoded
// separators or a second encoding layer, empty or dot segments, backslashes and control
// characters. Case is handled in resolveRequest.
export function canonicalPath(raw: string): string | undefined {
  if (!raw.startsWith("/") || /%2f|%5c|%00/i.test(raw)) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  if (path.includes("%") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return undefined;
  const segments = path.split("/").slice(1);
  if (segments.at(-1) === "") segments.pop(); // one trailing slash is fine
  if (segments.some((s) => s === "" || s === "." || s === "..")) return undefined;
  return path;
}

// `rawPath` is the request pathname as received (Next.js `nextUrl.pathname`).
// Development-only pages (component gallery, T-012) under /dev are refused in production.
export function isDevOnlyPath(path: string): boolean {
  return path === "/dev" || path.startsWith("/dev/");
}

export function resolveRequest(
  cfg: HostConfig,
  host: string | null,
  rawPath: string,
  production = process.env.NODE_ENV === "production",
): Decision {
  const kind = hostKind(cfg, host);
  if (!kind) return { allow: false, reason: "unknown host" };
  const path = canonicalPath(rawPath);
  if (path === undefined) return { allow: false, reason: "non-canonical path" };
  if (production && isDevOnlyPath(path.toLowerCase())) return { allow: false, reason: "development only" };
  // Route folders are lower-case but ids may not be: a path is allowed only if its
  // lower-cased form is allowed too, so /Vendor is treated like /vendor.
  const lower = path.toLowerCase();
  if (lower !== path && !decide(kind, lower).allow) {
    return { allow: false, reason: "route belongs to another host" };
  }
  return decide(kind, path);
}

function decide(kind: HostKind, path: string): Decision {
  if (any(path, SHARED)) return { allow: true, host: kind };
  switch (kind) {
    case "booking":
      return any(path, BOOKING_PREFIXES) || isPublicSitePath(path)
        ? { allow: true, host: kind }
        : { allow: false, reason: "not a booking-host route" };
    case "vendor":
      return any(path, VENDOR_PREFIXES)
        ? { allow: true, host: kind }
        : { allow: false, reason: "not a vendor-host route" };
    case "app":
      return any(path, BOOKING_PREFIXES) || any(path, VENDOR_PREFIXES) || isPublicSitePath(path)
        ? { allow: false, reason: "route belongs to another host" }
        : { allow: true, host: kind };
  }
}
