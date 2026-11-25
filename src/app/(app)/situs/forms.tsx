"use client";
// Client forms for Situs Klinik admin (UX-50, PR-64, PR-65; T-123).
import { useActionState } from "react";
import { ContextFields } from "../../../components/context-fields";
import type { RenderedContext } from "../../../modules/org/context/context";
import type { AdminServiceWebRow, SiteSettingsRow } from "../../../modules/public-site";
import {
  approveWebReviewAction,
  publishSiteAction,
  saveSiteSettingsAction,
  saveWebFieldAction,
  unpublishSiteAction,
  type SitusActionState,
} from "./actions";

function Feedback({ state }: { state: SitusActionState }) {
  if (!state.error && !state.ok) return null;
  return (
    <div
      role="status"
      className={
        state.error
          ? "grid gap-1.5 rounded-[var(--radius-field)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[0.875rem] text-[var(--danger)]"
          : "rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3.5 py-2.5 text-[0.875rem] text-[var(--success)]"
      }
    >
      <p className="m-0 font-medium">{state.error ?? state.ok}</p>
      {state.violations && state.violations.length > 0 && (
        <ul className="m-0 list-disc pl-5 text-[0.8125rem]">
          {state.violations.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SiteSettingsForm({
  ctx,
  site,
  suggestedSlug,
  counselGateOpen,
}: {
  ctx: RenderedContext;
  site: SiteSettingsRow | null;
  suggestedSlug: string;
  counselGateOpen: boolean;
}) {
  const [state, action, pending] = useActionState<SitusActionState, FormData>(saveSiteSettingsAction, {});
  const slugLocked = Boolean(site?.firstPublishedAt);

  return (
    <form action={action} className="grid min-w-0 gap-4 rounded-[var(--radius-group)] bg-[var(--surface)] p-5">
      <ContextFields ctx={ctx} />
      <h2 className="m-0 text-[1.125rem] font-semibold">Identitas &amp; Bagian Situs</h2>

      <div className="grid min-w-0 gap-3 min-[900px]:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-[0.875rem]">
          <span className="font-medium">Slug Situs</span>
          <input
            name="slug"
            defaultValue={site?.slug ?? suggestedSlug}
            readOnly={slugLocked}
            required
            className="min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3 text-[0.9375rem] read-only:bg-[var(--surface-2)] read-only:text-[var(--label-2)]"
          />
          <span className="text-[0.8125rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
            {slugLocked
              ? "Slug terkunci permanen setelah penerbitan pertama."
              : "Huruf kecil, angka, dan tanda hubung. Terkunci setelah pertama kali terbit."}
          </span>
        </label>

        <label className="grid min-w-0 gap-1 text-[0.875rem]">
          <span className="font-medium">Nama Brand di Situs</span>
          <input
            name="brandName"
            defaultValue={site?.brandName ?? ""}
            required
            className="min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3 text-[0.9375rem]"
          />
        </label>

        <label className="grid min-w-0 gap-1 text-[0.875rem]">
          <span className="font-medium">Warna Aksen (Hex)</span>
          <input
            name="accentHex"
            defaultValue={site?.accentHex ?? "#007AFF"}
            placeholder="#007AFF"
            className="min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3 text-[0.9375rem]"
          />
        </label>

        <label className="grid min-w-0 gap-1 text-[0.875rem]">
          <span className="font-medium">Ringkasan Satu Baris</span>
          <input
            name="oneLine"
            defaultValue={site?.oneLine ?? ""}
            placeholder="Klinik perawatan kulit dengan evaluasi dokter."
            maxLength={160}
            className="min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3 text-[0.9375rem]"
          />
        </label>
      </div>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 text-[0.875rem] font-medium">Bagian Aktif</legend>
        <label className="flex items-center gap-2.5 text-[0.9375rem]">
          <input type="checkbox" name="showTreatments" defaultChecked={site?.showTreatments ?? true} />
          <span>Tampilkan halaman Perawatan</span>
        </label>
        <label className="flex items-center gap-2.5 text-[0.9375rem]">
          <input type="checkbox" name="showBranches" defaultChecked={site?.showBranches ?? true} />
          <span>Tampilkan halaman Cabang</span>
        </label>
        <label className="flex items-center gap-2.5 text-[0.9375rem]">
          <input type="checkbox" name="showDoctors" defaultChecked={site?.showDoctors ?? false} />
          <span>Tampilkan halaman Dokter (hanya dokter dengan persetujuan aktif)</span>
        </label>
      </fieldset>

      <fieldset className="m-0 grid gap-2 border-t border-[var(--separator)] px-0 pb-0 pt-3">
        <legend className="mb-1 text-[0.875rem] font-medium">Izin Tambahan Sesuai Pendapat Hukum (Q-15)</legend>
        <label className="flex items-center gap-2.5 text-[0.9375rem]">
          <input
            type="checkbox"
            name="tariffListAllowed"
            defaultChecked={site?.tariffListAllowed ?? false}
            disabled={!counselGateOpen}
          />
          <span>Izinkan tampilan angka tarif untuk layanan yang ditandai &ldquo;Tampilkan Harga&rdquo;</span>
        </label>
        <label className="flex items-center gap-2.5 text-[0.9375rem]">
          <input
            type="checkbox"
            name="doctorTitlesAllowed"
            defaultChecked={site?.doctorTitlesAllowed ?? false}
            disabled={!counselGateOpen}
          />
          <span>Izinkan tampilan gelar tambahan dokter (terikat bukti hukum saat ini)</span>
        </label>
      </fieldset>

      <Feedback state={state} />

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--tint)] px-5 text-[0.9375rem] font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Menyimpan..." : "Simpan Pengaturan Situs"}
        </button>
      </div>
    </form>
  );
}

export function PublishControls({
  ctx,
  state: siteState,
  counselGateOpen,
  hasActiveBranch,
}: {
  ctx: RenderedContext;
  state: "draft" | "published" | "unpublished";
  counselGateOpen: boolean;
  hasActiveBranch: boolean;
}) {
  const [pubState, pubAction, pubPending] = useActionState<SitusActionState, FormData>(publishSiteAction, {});
  const [unpubState, unpubAction, unpubPending] = useActionState<SitusActionState, FormData>(unpublishSiteAction, {});

  return (
    <div className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-5">
      <h2 className="m-0 text-[1.125rem] font-semibold">Penerbitan Situs</h2>
      <div className="flex flex-wrap gap-3">
        <form action={pubAction}>
          <ContextFields ctx={ctx} />
          <button
            type="submit"
            disabled={pubPending || !counselGateOpen || !hasActiveBranch}
            className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--tint)] px-5 text-[0.9375rem] font-semibold text-white disabled:opacity-45"
          >
            {pubPending ? "Menerbitkan..." : siteState === "published" ? "Terbitkan Versi Baru" : "Terbitkan Situs"}
          </button>
        </form>

        {siteState === "published" && (
          <form action={unpubAction}>
            <ContextFields ctx={ctx} />
            <button
              type="submit"
              disabled={unpubPending}
              className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--danger-soft)] px-5 text-[0.9375rem] font-semibold text-[var(--danger)] disabled:opacity-45"
            >
              {unpubPending ? "Menurunkan..." : "Turunkan Situs"}
            </button>
          </form>
        )}
      </div>
      <Feedback state={pubState} />
      <Feedback state={unpubState} />
    </div>
  );
}

export function ServiceWebFieldCard({
  ctx,
  service,
  canApproveClinical,
}: {
  ctx: RenderedContext;
  service: AdminServiceWebRow;
  canApproveClinical: boolean;
}) {
  const [saveState, saveAction, savePending] = useActionState<SitusActionState, FormData>(saveWebFieldAction, {});
  const [revState, revAction, revPending] = useActionState<SitusActionState, FormData>(approveWebReviewAction, {});
  const wf = service.webField;
  const reviewedCurrent =
    wf !== null &&
    wf.clinicalReviewCurrent &&
    wf.clinicalReviewedVersion === service.activeVersion &&
    wf.clinicalReviewedArtifactSha === wf.currentArtifactSha;

  return (
    <div className="grid min-w-0 gap-3 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-[1.0625rem] font-semibold [overflow-wrap:anywhere]">{service.name}</h3>
          <p className="m-0 text-[0.8125rem] text-[var(--label-2)]">
            Kode {service.code} · Versi katalog v{service.activeVersion}
          </p>
        </div>
        <span
          className={
            reviewedCurrent
              ? "rounded-full bg-[var(--success-soft)] px-3 py-1 text-[0.75rem] font-semibold text-[var(--success)]"
              : "rounded-full bg-[var(--warning-soft)] px-3 py-1 text-[0.75rem] font-semibold text-[var(--warning)]"
          }
        >
          {reviewedCurrent ? "Direview Klinis" : "Menunggu Review Klinis"}
        </span>
      </div>

      <form action={saveAction} className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} />
        <input type="hidden" name="itemId" value={service.itemId} />

        <div className="grid min-w-0 gap-3 min-[900px]:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-[0.875rem]">
            <span className="font-medium">Slug Halaman Perawatan</span>
            <input
              name="publicSlug"
              defaultValue={wf?.publicSlug ?? service.code.toLowerCase()}
              required
              className="min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3 text-[0.9375rem]"
            />
          </label>

          <label className="grid min-w-0 gap-1 text-[0.875rem]">
            <span className="font-medium">Dilakukan Oleh</span>
            <input
              name="performedBy"
              defaultValue={wf?.performedBy ?? "Dokter atau tenaga medis berwenang"}
              required
              className="min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3 text-[0.9375rem]"
            />
          </label>
        </div>

        <label className="grid min-w-0 gap-1 text-[0.875rem]">
          <span className="font-medium">Tujuan Tindakan (Bahasa Netral, Tanpa Superlatif/Janji Hasil)</span>
          <textarea
            name="purpose"
            rows={2}
            defaultValue={wf?.purpose ?? ""}
            required
            className="w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] p-3 text-[0.9375rem]"
          />
        </label>

        <div className="grid min-w-0 gap-3 min-[900px]:grid-cols-3">
          <label className="grid min-w-0 gap-1 text-[0.875rem]">
            <span className="font-medium">Masa Pemulihan</span>
            <input
              name="downtime"
              defaultValue={wf?.downtime ?? ""}
              className="min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3 text-[0.9375rem]"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-[0.875rem]">
            <span className="font-medium">Jumlah Sesi</span>
            <input
              name="sessions"
              type="number"
              min={1}
              max={50}
              defaultValue={wf?.sessions ?? ""}
              className="min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3 text-[0.9375rem]"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-[0.875rem]">
            <span className="font-medium">Catatan Tarif (Hanya Jika Tarif Terbit)</span>
            <input
              name="priceNote"
              defaultValue={wf?.priceNote ?? ""}
              className="min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3 text-[0.9375rem]"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-[0.9375rem]">
            <input type="checkbox" name="published" defaultChecked={wf?.published ?? false} />
            <span>Tampilkan di Situs Publik</span>
          </label>
          <label className="flex items-center gap-2 text-[0.9375rem]">
            <input type="checkbox" name="publishPrice" defaultChecked={wf?.publishPrice ?? false} />
            <span>Tampilkan Harga (membutuhkan izin tarif di bukti Q-15)</span>
          </label>
        </div>

        <Feedback state={saveState} />

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={savePending}
            className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--surface-2)] px-4 text-[0.875rem] font-semibold text-[var(--label)] disabled:opacity-45"
          >
            {savePending ? "Menyimpan..." : "Simpan Konten Layanan"}
          </button>
        </div>
      </form>

      {canApproveClinical && wf && !reviewedCurrent && (
        <form action={revAction} className="grid min-w-0 gap-3 border-t border-[var(--separator)] pt-3">
          <ContextFields ctx={ctx} />
          <input type="hidden" name="itemId" value={service.itemId} />
          <input type="hidden" name="expectedVersion" value={String(service.activeVersion)} />
          <input type="hidden" name="expectedArtifactSha" value={wf.currentArtifactSha} />
          <div className="grid min-w-0 gap-1.5 rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] p-3 text-[0.8125rem]">
            <p className="m-0 font-semibold text-[var(--label)]">
              Revisi tersimpan yang akan disetujui (v{service.activeVersion} · {wf.currentArtifactSha.slice(0, 12)})
            </p>
            <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">
              <strong>Nama:</strong> {service.name} · <strong>Slug:</strong> /{wf.publicSlug}
            </p>
            <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">
              <strong>Tujuan:</strong> {wf.purpose}
            </p>
            <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">
              <strong>Pelaksana:</strong> {wf.performedBy}
              {service.durationMin ? ` · Durasi ${service.durationMin} menit` : ""}
              {wf.downtime ? ` · Pemulihan: ${wf.downtime}` : ""}
              {wf.sessions ? ` · ${wf.sessions} sesi${wf.intervalDays ? ` (jarak ${wf.intervalDays} hari)` : ""}` : ""}
            </p>
            <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">
              <strong>Kontraindikasi katalog:</strong> {service.contraindications ?? "Tidak ada"}
            </p>
            {(wf.heroPhoto || wf.heroAlt || wf.caption) && (
              <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">
                <strong>Media:</strong> {wf.heroPhoto ?? "-"} · <strong>Alt:</strong> {wf.heroAlt ?? "-"} · <strong>Keterangan:</strong>{" "}
                {wf.caption ?? "-"}
              </p>
            )}
          </div>
          <Feedback state={revState} />
          <div>
            <button
              type="submit"
              disabled={revPending}
              className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--tint)] px-4 text-[0.875rem] font-semibold text-white disabled:opacity-45"
            >
              {revPending ? "Menyetujui..." : "Setujui Review Klinis Revisi Ini"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
