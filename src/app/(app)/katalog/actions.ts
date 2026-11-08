"use server";
// Katalog actions (UX-25, PR-41): publish a new version (Simpan / Minta Review) and withdraw a
// pending change (clinical or materials review, T-034) (the requester; through the approvals engine, which moves the version).
// Each refuses a form rendered in another context first (HYG-009 B2-1); the database decides roles,
// the clinical review gate and the item lock (DEC-046).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { cancelApproval } from "../../../modules/approvals/approvals";
import { CatalogError, type CatalogFields, publish } from "../../../modules/catalog/catalog";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

export type KatalogState = { error?: string; ok?: string; values?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["service", "product", "package", "material"] as const;
const TAX = ["exempt_medical", "taxable_service", "taxable_goods", "non_object"] as const;
const SCOPES = ["guiding_bc", "closing_bc", "new_patient", "performer"] as const;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat mengubah katalog.",
  ERR_NOT_FOUND: "Item tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Kode sudah dipakai atau data sudah berubah. Muat ulang halaman.",
  catalog_review_pending: "Perubahan item ini masih menunggu review. Tunggu keputusannya atau tarik ajuannya dulu.",
  delegation_floor: "Staf & Delegasi item ini tidak lagi sesuai batas hukum. Ubah di Master Layanan.",
  category_required: "Pilih kategori layanan di Master Layanan.",
  ERR_INVALID_INPUT: "Periksa kembali isian: ada nilai yang tidak valid.",
};

const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
// Whole rupiah or count: digits only (thousand separators allowed), empty = null.
function whole(f: FormData, k: string): number | null | "bad" {
  const s = str(f, k).replace(/[.\s]/g, "");
  if (s === "") return null;
  return /^\d{1,13}$/.test(s) ? Number(s) : "bad";
}

function fieldsOf(f: FormData): CatalogFields | string {
  const price = whole(f, "normal_price");
  const controlCount = whole(f, "control_count");
  const controlDays = whole(f, "control_validity_days");
  const dp = whole(f, "booking_dp_amount");
  const minDp = whole(f, "min_dp_pct");
  const validity = whole(f, "validity_days");
  const tax = str(f, "tax_category");
  if ([price, controlCount, controlDays, dp, minDp, validity].includes("bad")) return "Angka hanya boleh berisi digit.";
  if (price === null) return "Isi harga normal.";
  if (!(TAX as readonly string[]).includes(tax)) return "Pilih kategori pajak.";
  const scopes = f.getAll("commission_scope").filter((x): x is string => typeof x === "string" && (SCOPES as readonly string[]).includes(x));
  const dpOn = f.get("booking_dp_enabled") === "1";
  return {
    name: str(f, "name"),
    tax_category: tax as CatalogFields["tax_category"],
    tax_basis: str(f, "tax_basis"),
    normal_price: price as number,
    control_count: (controlCount as number | null) ?? 0,
    control_validity_days: controlDays as number | null,
    booking_dp_enabled: dpOn,
    booking_dp_amount: dpOn ? (dp as number | null) : null,
    min_dp_pct: minDp as number | null,
    installments_allowed: f.get("installments_allowed") === "1",
    validity_days: validity as number | null,
    commission_scope: scopes,
    indications: str(f, "indications") || null,
    contraindications: str(f, "contraindications") || null,
    consent_template: str(f, "consent_template") || null,
    delegation: str(f, "delegation") || null,
  };
}

function keep(f: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$")) out[k] = v;
  return out;
}

export async function publishAction(_p: KatalogState, f: FormData): Promise<KatalogState> {
  const itemId = str(f, "item");
  const kind = str(f, "kind");
  const code = str(f, "code");
  const reason = str(f, "reason");
  if (itemId && !UUID.test(itemId)) return { error: COPY.ERR_NOT_FOUND };
  if (!itemId && (!(KINDS as readonly string[]).includes(kind) || !/^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/.test(code))) return { error: "Pilih jenis dan isi kode (huruf, angka, tanda hubung).", values: keep(f) };
  if (reason.length < 3) return { error: "Tulis alasan perubahan.", values: keep(f) };
  const fields = fieldsOf(f);
  if (typeof fields === "string") return { error: fields, values: keep(f) };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT, values: keep(f) };
  let result;
  try {
    result = await withTenantContext(await appPool(), rc.active.context, (db) =>
      publish(db, itemId ? { itemId } : { kind: kind as (typeof KINDS)[number], code }, fields, reason));
  } catch (e) {
    if (e instanceof CatalogError && e.reason) return { error: COPY[e.reason] ?? COPY.ERR_FORBIDDEN, values: keep(f) };
    if (e instanceof CommandError) return { error: COPY[e.code] ?? COPY.ERR_FORBIDDEN, values: keep(f) };
    console.error("katalog: publish failed", { error: e instanceof Error ? e.message : String(e) });
    return { error: "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.", values: keep(f) };
  }
  revalidatePath("/katalog");
  // No result code in the URL (T-028 lesson): the detail page shows the item's real state (active
  // version, or the change waiting for clinical review).
  redirect(`/katalog/${result.itemId}`);
}

export async function withdrawAction(_p: KatalogState, f: FormData): Promise<KatalogState> {
  const approval = str(f, "approval");
  const itemId = str(f, "item");
  if (!UUID.test(approval) || !UUID.test(itemId)) return { error: COPY.ERR_NOT_FOUND };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => cancelApproval(db, approval));
  } catch (e) {
    if (e instanceof CommandError) return { error: e.code === "ERR_NOT_FOUND" ? "Ajuan ini sudah diputuskan atau bukan milik Anda. Muat ulang halaman." : COPY.ERR_FORBIDDEN };
    throw e;
  }
  revalidatePath("/katalog");
  revalidatePath(`/katalog/${itemId}`);
  return { ok: "Ajuan ditarik. Versi aktif tidak berubah." };
}
