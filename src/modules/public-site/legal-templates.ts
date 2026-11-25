// Safe plain-text legal template renderer for public policy pages (T-123 + T-129 Finding #9).
// Strict allowlist of placeholders ONLY; rejects ANY malformed/unmatched braces or unknown tokens.
// Output is plain text rendered escaped by React (never raw HTML / dangerouslySetInnerHTML).
import { createHash } from "node:crypto";

export const TEMPLATE_KINDS = ["kebijakan-privasi", "syarat-ketentuan", "kebijakan-pembatalan"] as const;
export type LegalTemplateKind = (typeof TEMPLATE_KINDS)[number];

export const ALLOWED_TOKENS = [
  "klinik.nama",
  "klinik.alamat",
  "klinik.kontak",
  "klinik.email",
  "vendor.nama",
] as const;
export type AllowedTemplateToken = (typeof ALLOWED_TOKENS)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_TOKENS);

export type TemplateVars = Record<AllowedTemplateToken, string>;

export type TemplateValidation =
  | { ok: true; sha256: string }
  | { ok: false; error: string };

export function validateLegalTemplate(body: string): TemplateValidation {
  if (!body || body.trim().length < 20 || body.length > 50_000) {
    return { ok: false, error: "template_length_invalid" };
  }
  if (/[<>]/.test(body)) {
    return { ok: false, error: "html_angle_brackets_forbidden" };
  }
  // Scan character by character so ANY lone `{`, `}`, nested brace, or malformed token is rejected.
  let i = 0;
  while (i < body.length) {
    if (body[i] === "{") {
      if (body[i + 1] !== "{") return { ok: false, error: "malformed_open_brace" };
      const end = body.indexOf("}}", i + 2);
      if (end < 0) return { ok: false, error: "unclosed_token" };
      const token = body.slice(i + 2, end);
      if (token.includes("{") || token.includes("}") || !ALLOWED_SET.has(token)) {
        return { ok: false, error: `unknown_token:${token.slice(0, 32)}` };
      }
      i = end + 2;
      continue;
    }
    if (body[i] === "}") {
      return { ok: false, error: "unmatched_close_brace" };
    }
    i++;
  }
  const sha256 = createHash("sha256").update(body, "utf8").digest("hex");
  return { ok: true, sha256 };
}

export function renderLegalTemplate(body: string, vars: TemplateVars): string {
  const check = validateLegalTemplate(body);
  if (!check.ok) throw new Error(`ERR_INVALID_INPUT: ${check.error}`);
  return body.replace(/\{\{([a-z.]+)\}\}/g, (_m, tok: string) => vars[tok as AllowedTemplateToken] ?? "");
}

export const DEFAULT_LEGAL_TEMPLATES: Record<LegalTemplateKind, string> = {
  "kebijakan-privasi":
    "Kebijakan Privasi {{klinik.nama}}\n\n{{klinik.nama}} (alamat: {{klinik.alamat}}, kontak: {{klinik.kontak}}, email: {{klinik.email}}) mengelola data pribadi dan rekam medis pasien sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi dan Permenkes No. 24 Tahun 2022. Sistem dikelola secara teknis oleh {{vendor.nama}} sebagai pemroses data.\n\nPasien berhak mengajukan permintaan akses, perbaikan, penarikan persetujuan, atau pembatasan pemrosesan melalui kontak resmi klinik.",
  "syarat-ketentuan":
    "Syarat dan Ketentuan {{klinik.nama}}\n\nLayanan informasi daring pada situs resmi {{klinik.nama}} bersifat edukatif dan informatif sesuai Permenkes 1787/2010, bukan pengganti konsultasi medis langsung. Seluruh jadwal kunjungan dan tindakan tunduk pada evaluasi dokter di {{klinik.alamat}} (kontak: {{klinik.kontak}}).",
  "kebijakan-pembatalan":
    "Kebijakan Pembatalan dan Perubahan Jadwal {{klinik.nama}}\n\nPerubahan jadwal atau pembatalan kunjungan dapat dilakukan melalui kontak resmi {{klinik.nama}} di {{klinik.kontak}} atau {{klinik.email}}. Ketentuan pengembalian uang muka mengikuti kebijakan klinik yang berlaku saat reservasi.",
};
