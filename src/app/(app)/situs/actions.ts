"use server";
// Situs Klinik actions (PR-64, PR-65, UX-50; T-123).
// Every action verifies session + active tenant context + staleContext(FormData) before touching DB.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import {
  approvePublicWebReview,
  publishPublicSite,
  savePublicWebField,
  saveSiteSettings,
  unpublishPublicSite,
  validSlug,
} from "../../../modules/public-site";

export type SitusActionState = {
  error?: string;
  ok?: string;
  violations?: string[];
};

const MESSAGES: Record<string, string> = {
  ERR_FORBIDDEN: "Anda tidak memiliki akses untuk mengelola situs klinik.",
  ERR_INVALID_INPUT: "Isian belum valid. Periksa kembali slug, tautan, atau teks.",
  ERR_SLUG_IMMUTABLE: "Slug situs tidak dapat diubah setelah pertama kali diterbitkan.",
  ERR_SLUG_TAKEN: "Slug situs sudah digunakan klinik lain. Pilih slug lain.",
  ERR_SLUG_RESERVED: "Slug tersebut dicadangkan sistem. Pilih nama slug lain.",
  ERR_GATE_CLOSED: "Bukti pendapat hukum situs klinik (Q-15) belum disetujui atau sudah kedaluwarsa.",
  ERR_NOT_FOUND: "Data situs atau layanan tidak ditemukan.",
  ERR_CONFLICT: "Konten atau versi layanan berubah sejak halaman dimuat. Muat ulang dan tinjau kembali sebelum melanjutkan.",
  ERR_INVALID_SNAPSHOT: "Konten publik tidak lolos pemeriksaan aturan Permenkes 1787/2010, review klinis, atau tarif.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

async function runAction(
  f: FormData,
  fn: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0]) => Promise<SitusActionState>,
): Promise<SitusActionState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: MESSAGES.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  try {
    return await withTenantContext(await appPool(), rc.active.context, fn);
  } catch (e) {
    if (e instanceof CommandError) {
      return { error: MESSAGES[e.code] ?? "Belum tersimpan. Periksa isian lalu coba lagi." };
    }
    return { error: "Belum pasti tersimpan. Muat ulang halaman untuk memeriksa status." };
  }
}

export async function saveSiteSettingsAction(
  _prev: SitusActionState,
  f: FormData,
): Promise<SitusActionState> {
  const slug = String(f.get("slug") ?? "").trim().toLowerCase();
  const brandName = String(f.get("brandName") ?? "").trim();
  const accentHex = String(f.get("accentHex") ?? "").trim() || null;
  const heroPhoto = String(f.get("heroPhoto") ?? "").trim() || null;
  const oneLine = String(f.get("oneLine") ?? "").trim() || null;
  const showTreatments = f.get("showTreatments") === "on";
  const showBranches = f.get("showBranches") === "on";
  const showDoctors = f.get("showDoctors") === "on";
  const tariffListAllowed = f.get("tariffListAllowed") === "on";
  const doctorTitlesAllowed = f.get("doctorTitlesAllowed") === "on";

  if (!validSlug(slug)) return { error: "Slug harus huruf kecil, angka, atau tanda hubung dan bukan kata sistem." };
  if (brandName.length < 2 || brandName.length > 120) return { error: "Nama klinik minimal 2 karakter." };

  const res = await runAction(f, async (db) => {
    await saveSiteSettings(db, {
      slug,
      brandName,
      accentHex,
      heroPhoto,
      oneLine,
      showTreatments,
      showBranches,
      showDoctors,
      tariffListAllowed,
      doctorTitlesAllowed,
    });
    return { ok: "Pengaturan situs klinik tersimpan." };
  });
  if (res.ok) revalidatePath("/situs");
  return res;
}

export async function saveWebFieldAction(
  _prev: SitusActionState,
  f: FormData,
): Promise<SitusActionState> {
  const itemId = String(f.get("itemId") ?? "").trim();
  const publicSlug = String(f.get("publicSlug") ?? "").trim().toLowerCase();
  const published = f.get("published") === "on";
  const publishPrice = f.get("publishPrice") === "on";
  const purpose = String(f.get("purpose") ?? "").trim();
  const performedBy = String(f.get("performedBy") ?? "").trim();
  const downtime = String(f.get("downtime") ?? "").trim() || null;
  const sessionsRaw = String(f.get("sessions") ?? "").trim();
  const intervalRaw = String(f.get("intervalDays") ?? "").trim();
  const priceNote = String(f.get("priceNote") ?? "").trim() || null;
  const heroPhoto = String(f.get("heroPhoto") ?? "").trim() || null;
  const heroAlt = String(f.get("heroAlt") ?? "").trim() || null;
  const caption = String(f.get("caption") ?? "").trim() || null;

  if (!UUID.test(itemId)) return { error: MESSAGES.ERR_NOT_FOUND };
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(publicSlug)) return { error: "Slug layanan tidak valid." };
  if (purpose.length < 3) return { error: "Ringkasan tujuan tindakan minimal 3 karakter." };
  if (performedBy.length < 2) return { error: "Isi pelaksana tindakan." };

  const sessions = sessionsRaw ? Number.parseInt(sessionsRaw, 10) : null;
  const intervalDays = intervalRaw ? Number.parseInt(intervalRaw, 10) : null;
  if (sessions !== null && (!Number.isSafeInteger(sessions) || sessions < 1 || sessions > 50)) {
    return { error: "Jumlah sesi harus 1–50." };
  }
  if (intervalDays !== null && (!Number.isSafeInteger(intervalDays) || intervalDays < 1 || intervalDays > 365)) {
    return { error: "Jarak antar sesi harus 1–365 hari." };
  }

  const res = await runAction(f, async (db) => {
    await savePublicWebField(db, {
      itemId,
      publicSlug,
      published,
      publishPrice,
      purpose,
      performedBy,
      downtime,
      sessions,
      intervalDays,
      priceNote,
      heroPhoto,
      heroAlt,
      caption,
    });
    return { ok: "Konten publik layanan tersimpan. Perlu review Penanggung Jawab Klinik sebelum terbit." };
  });
  if (res.ok) revalidatePath("/situs");
  return res;
}

export async function approveWebReviewAction(
  _prev: SitusActionState,
  f: FormData,
): Promise<SitusActionState> {
  const itemId = String(f.get("itemId") ?? "").trim();
  const expectedVersionRaw = String(f.get("expectedVersion") ?? "").trim();
  const expectedArtifactSha = String(f.get("expectedArtifactSha") ?? "").trim().toLowerCase();
  const expectedVersion = Number.parseInt(expectedVersionRaw, 10);

  if (!UUID.test(itemId)) return { error: MESSAGES.ERR_NOT_FOUND };
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !SHA256.test(expectedArtifactSha)) {
    return { error: MESSAGES.ERR_CONFLICT };
  }
  const res = await runAction(f, async (db) => {
    await approvePublicWebReview(db, itemId, {
      version: expectedVersion,
      artifactSha256: expectedArtifactSha,
    });
    return { ok: "Teks klinis layanan disetujui sesuai revisi yang ditinjau." };
  });
  if (res.ok) revalidatePath("/situs");
  return res;
}

export async function publishSiteAction(
  _prev: SitusActionState,
  f: FormData,
): Promise<SitusActionState> {
  const res = await runAction(f, async (db) => {
    const out = await publishPublicSite(db);
    if (!out.ok) {
      if (out.reason === "counsel_evidence") return { error: MESSAGES.ERR_GATE_CLOSED };
      if (out.reason === "no_branch") return { error: "Minimal satu cabang harus aktif dalam jendela publikasi." };
      if (out.reason === "slug") return { error: "Slug situs belum valid." };
      if (out.reason === "invalid_media") return { error: "Media hero harus berasal dari penyimpanan publik klinik." };
      return {
        error: "Penerbitan ditolak karena masih ada temuan aturan Permenkes 1787/2010 atau review klinis.",
        violations: out.violations.map((v) => `${v.field}: ${v.message}`),
      };
    }
    return { ok: `Situs klinik diterbitkan (versi ${out.version}) di /${out.slug}.` };
  });
  if (res.ok) revalidatePath("/situs");
  return res;
}

export async function unpublishSiteAction(
  _prev: SitusActionState,
  f: FormData,
): Promise<SitusActionState> {
  const res = await runAction(f, async (db) => {
    await unpublishPublicSite(db);
    return { ok: "Situs klinik diturunkan dari akses publik. Slug tetap terkunci untuk klinik Anda." };
  });
  if (res.ok) revalidatePath("/situs");
  return res;
}
