"use server";
// Master Layanan actions (UX-25, PR-88, T-034): publish a service version with its durations,
// resources, staff eligibility, recipe, consent, aftercare and online-booking flag (Simpan, or Minta
// Review when a clinical or recipe change needs review), and withdraw the open review. Each refuses a
// form rendered in another context first (HYG-009 B2-1); the database decides roles, the review gates,
// the legal delegation floor and the item lock (DEC-046, DEC-047).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { cancelApproval } from "../../../modules/approvals/approvals";
import { CatalogError, type CatalogFields, publish } from "../../../modules/catalog/catalog";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

export type LayananState = { error?: string; ok?: string; values?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAX = ["exempt_medical", "taxable_service", "taxable_goods", "non_object"] as const;
const SCOPES = ["guiding_bc", "closing_bc", "new_patient", "performer"] as const;
const MODES = ["performs", "supervised", "assists"];
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat mengubah Master Layanan.",
  ERR_NOT_FOUND: "Layanan tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Kode sudah dipakai atau data sudah berubah. Muat ulang halaman.",
  catalog_review_pending: "Perubahan layanan ini masih menunggu review. Tunggu keputusannya atau tarik ajuannya dulu.",
  delegation_floor: "Staf & Delegasi melebihi batas hukum untuk kategori ini, atau staf yang dipilih bukan tenaga klinis aktif.",
  category_required: "Pilih kategori layanan sebelum mengatur staf yang boleh.",
  ERR_INVALID_INPUT: "Periksa kembali isian: ada nilai yang tidak valid.",
};

const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
// Whole rupiah, count or minutes: digits only (thousand separators allowed), empty = null.
function whole(f: FormData, k: string): number | null | "bad" {
  const s = str(f, k).replace(/[.\s]/g, "");
  if (s === "") return null;
  return /^\d{1,13}$/.test(s) ? Number(s) : "bad";
}

function fieldsOf(f: FormData): CatalogFields | string {
  const nums = ["normal_price", "control_count", "control_validity_days", "booking_dp_amount", "min_dp_pct", "validity_days", "prep_min", "treatment_min", "buffer_min"] as const;
  const n = Object.fromEntries(nums.map((k) => [k, whole(f, k)])) as Record<(typeof nums)[number], number | null | "bad">;
  if (Object.values(n).includes("bad")) return "Angka hanya boleh berisi digit.";
  if (n.normal_price === null) return "Isi harga normal.";
  if (n.prep_min === null || n.treatment_min === null || n.buffer_min === null) return "Isi durasi persiapan, tindakan dan jeda (menit).";
  const tax = str(f, "tax_category");
  if (!(TAX as readonly string[]).includes(tax)) return "Pilih kategori pajak.";
  // Recipe rows: material, quantity (comma or dot decimals), unit; an empty row is skipped.
  const formula: { material: string; qty: number; unit: string }[] = [];
  for (let i = 0; f.has(`bhp_material_${i}`); i++) {
    const material = str(f, `bhp_material_${i}`);
    const qty = str(f, `bhp_qty_${i}`).replace(",", ".");
    const unit = str(f, `bhp_unit_${i}`);
    if (!material && !qty && !unit) continue;
    if (!material || !unit || !/^\d{1,6}(\.\d{1,3})?$/.test(qty) || Number(qty) <= 0) return "Setiap baris resep BHP perlu bahan, jumlah lebih dari 0 dan satuan.";
    formula.push({ material, qty: Number(qty), unit });
  }
  const eligibility: { role?: string; staff_id?: string; mode: string }[] = [];
  for (const [k, v] of f.entries()) {
    if (typeof v !== "string" || !MODES.includes(v)) continue;
    if (k.startsWith("elig_role_")) eligibility.push({ role: k.slice(10), mode: v });
    else if (k.startsWith("elig_staff_") && UUID.test(k.slice(11))) eligibility.push({ staff_id: k.slice(11), mode: v });
  }
  const dpOn = f.get("booking_dp_enabled") === "1";
  return {
    name: str(f, "name"),
    tax_category: tax as CatalogFields["tax_category"],
    tax_basis: str(f, "tax_basis"),
    normal_price: n.normal_price as number,
    control_count: (n.control_count as number | null) ?? 0,
    control_validity_days: n.control_validity_days as number | null,
    booking_dp_enabled: dpOn,
    booking_dp_amount: dpOn ? (n.booking_dp_amount as number | null) : null,
    min_dp_pct: n.min_dp_pct as number | null,
    installments_allowed: f.get("installments_allowed") === "1",
    validity_days: n.validity_days as number | null,
    commission_scope: f.getAll("commission_scope").filter((x): x is string => typeof x === "string" && (SCOPES as readonly string[]).includes(x)),
    indications: str(f, "indications") || null,
    contraindications: str(f, "contraindications") || null,
    consent_template: str(f, "consent_template") || null,
    delegation: str(f, "delegation") || null,
    category: str(f, "category") || null,
    prep_min: n.prep_min as number,
    treatment_min: n.treatment_min as number,
    buffer_min: n.buffer_min as number,
    online_bookable: f.get("online_bookable") === "1",
    aftercare_text: str(f, "aftercare_text") || null,
    resources: f.getAll("resource").filter((x): x is string => typeof x === "string" && /^(room|device):[a-z_]{2,32}$/.test(x))
      .map((x) => ({ kind: x.split(":")[0] as "room" | "device", code: x.split(":")[1] })),
    eligibility,
    material_formula: formula,
  };
}

function keep(f: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$")) out[k] = out[k] !== undefined ? `${out[k]}\n${v}` : v;
  return out;
}

export async function publishServiceAction(_p: LayananState, f: FormData): Promise<LayananState> {
  const itemId = str(f, "item");
  const code = str(f, "code");
  const reason = str(f, "reason");
  if (itemId && !UUID.test(itemId)) return { error: COPY.ERR_NOT_FOUND };
  if (!itemId && !/^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/.test(code)) return { error: "Isi kode layanan (huruf, angka, tanda hubung).", values: keep(f) };
  if (reason.length < 3) return { error: "Tulis alasan perubahan.", values: keep(f) };
  const fields = fieldsOf(f);
  if (typeof fields === "string") return { error: fields, values: keep(f) };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT, values: keep(f) };
  let result;
  try {
    result = await withTenantContext(await appPool(), rc.active.context, (db) => publish(db, itemId ? { itemId } : { kind: "service", code }, fields, reason));
  } catch (e) {
    if (e instanceof CatalogError && e.reason) return { error: COPY[e.reason] ?? COPY.ERR_INVALID_INPUT, values: keep(f) };
    if (e instanceof CommandError) return { error: COPY[e.code] ?? COPY.ERR_FORBIDDEN, values: keep(f) };
    console.error("layanan: publish failed", { error: e instanceof Error ? e.message : String(e) });
    return { error: "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.", values: keep(f) };
  }
  revalidatePath("/layanan");
  revalidatePath("/katalog");
  // No result code in the URL (T-028 lesson): the detail page shows the real state.
  redirect(`/layanan/${result.itemId}`);
}

// Withdraw the open review of a pending version (the requester): the trigger cancels the other open
// review and withdraws the version (DEC-047 (2)).
export async function withdrawServiceAction(_p: LayananState, f: FormData): Promise<LayananState> {
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
  revalidatePath("/layanan");
  revalidatePath(`/layanan/${itemId}`);
  revalidatePath("/katalog");
  return { ok: "Ajuan ditarik. Versi aktif tidak berubah." };
}
