"use client";
// UX-30 ▸ Permintaan interactive forms (PR-50; T-121). All forms embed ContextFields (HYG-009 B2-1),
// enforce >= 44px touch targets and DESIGN.md tokens, and require explicit officer confirmation of
// received_at (never silently defaulted).
import Link from "next/link";
import { useActionState, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import {
  allowedLinkKinds,
  CHANNEL_LABEL,
  CHANNELS,
  CORRECTION_SCOPE_LABEL,
  CORRECTION_SCOPES,
  IDENTITY_METHOD_LABEL,
  IDENTITY_METHODS,
  identityMethodFits,
  LINK_KIND_LABEL,
  OUTCOME_BASIS_LABEL,
  OUTCOMES,
  REQUESTER_LABEL,
  REQUESTERS,
  RESTRICTION_PURPOSE_LABEL,
  RESTRICTION_PURPOSES,
  RIGHT_LABEL,
  RIGHTS,
  type DsrDetail,
  type DsrLinkOptions,
  type Outcome,
  type OutcomeBasisCode,
  type Right,
} from "../../../../modules/privacy/requests";
import {
  assignDsrAction,
  bindSubjectAction,
  closeDsrAction,
  confirmCopyHandoffAction,
  linkEvidenceAction,
  logDsrAction,
  verifyIdentityAction,
  type DsrActionState,
} from "./actions";
import { OUTCOME } from "./model";

const fieldCls = "min-h-[var(--target)] w-full rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-[1rem] text-[var(--label)]";
const cardCls = "grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const labelCls = "grid gap-1 text-[0.94rem] font-medium text-[var(--label)]";

function Notice({ state }: { state: DsrActionState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`m-0 rounded-[var(--radius-field)] px-3 py-2 text-[0.94rem] ${
        state.error ? "bg-danger-soft text-destructive" : "bg-success-soft text-success"
      }`}
    >
      {state.error ?? state.ok}
      {state.createdId && (
        <>
          {" "}
          <Link href={`/privasi/permintaan/${state.createdId}`} className="underline">
            Buka detail permintaan
          </Link>
        </>
      )}
    </p>
  );
}

const BASES_BY_OUTCOME: Record<Outcome, readonly OutcomeBasisCode[]> = {
  fulfilled: ["fulfilled_delivered", "fulfilled_corrected", "fulfilled_consent_withdrawn", "fulfilled_restricted"],
  partially_fulfilled: ["partial_medical_record_retention_pmk24_2022", "partial_demographic_edit_pending", "partial_subset_applied"],
  refused: [
    "refused_medical_record_retention_pmk24_2022",
    "refused_statutory_tax_accounting_retention",
    "refused_demographic_edit_unavailable",
    "refused_unverifiable_or_unauthorized",
    "refused_no_matching_data",
  ],
  withdrawn: ["withdrawn_by_requester"],
};

export function LogDsrForm({ ctx }: { ctx: RenderedContext }) {
  const [state, action, pending] = useActionState(logDsrAction, {});
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [right, setRight] = useState<Right>("access");

  return (
    <form
      action={(fd) => {
        if (state.ok) setKey(crypto.randomUUID());
        return action(fd);
      }}
      className={cardCls}
    >
      <ContextFields ctx={ctx} />
      <input type="hidden" name="key" value={key} />
      <h2 className="m-0 text-[1.1rem] font-semibold">Catat permintaan data pasien</h2>
      <Notice state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          <span>Hak yang diminta</span>
          <select name="right" value={right} onChange={(e) => setRight(e.target.value as Right)} className={fieldCls}>
            {RIGHTS.map((r) => (
              <option key={r} value={r}>{RIGHT_LABEL[r]}</option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          <span>Pemohon</span>
          <select name="requester_kind" defaultValue="patient" className={fieldCls}>
            {REQUESTERS.map((r) => (
              <option key={r} value={r}>{REQUESTER_LABEL[r]}</option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          <span>Saluran diterima</span>
          <select name="channel" defaultValue="in_person" className={fieldCls}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          <span>Waktu pertama diterima (WIB)</span>
          <input name="received_at" type="datetime-local" required className={fieldCls} />
        </label>
      </div>
      {right === "correction" && (
        <label className={labelCls}>
          <span>Ruang lingkup perbaikan</span>
          <select name="correction_scope" defaultValue="clinical" className={fieldCls}>
            {CORRECTION_SCOPES.map((s) => (
              <option key={s} value={s}>{CORRECTION_SCOPE_LABEL[s]}</option>
            ))}
          </select>
        </label>
      )}
      {right === "restriction" && (
        <fieldset className="m-0 grid gap-2 rounded-[var(--radius-field)] border border-[var(--separator)] p-3">
          <legend className="px-1 text-[0.94rem] font-medium">Tujuan pemrosesan yang dibatasi</legend>
          {RESTRICTION_PURPOSES.map((p) => (
            <label key={p} className="inline-flex min-h-[var(--target)] items-center gap-2">
              <input type="checkbox" name="requested_purposes" value={p} className="h-5 w-5" />
              <span>{RESTRICTION_PURPOSE_LABEL[p]}</span>
            </label>
          ))}
        </fieldset>
      )}
      <label className={labelCls}>
        <span>ID Pasien (opsional — dapat diikat sebelum verifikasi identitas)</span>
        <input name="patient_id" type="text" placeholder="UUID pasien (kosongkan jika belum diketahui)" className={fieldCls} />
      </label>
      <label className="inline-flex min-h-[var(--target)] items-center gap-2 text-[0.94rem]">
        <input type="checkbox" name="confirm_received_at" required className="h-5 w-5" />
        <span>Saya mengonfirmasi waktu pertama permintaan diterima (tenggat 3×24 jam dihitung dari waktu ini).</span>
      </label>
      <div>
        <Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Catat Permintaan"}</Button>
      </div>
    </form>
  );
}

export function BindSubjectForm({ ctx, detail }: { ctx: RenderedContext; detail: DsrDetail }) {
  const [state, action, pending] = useActionState(bindSubjectAction, {});
  if (detail.state === "closed" || detail.patientId || detail.identityVerifiedAt) return null;
  return (
    <form action={action} className={cardCls}>
      <ContextFields ctx={ctx} />
      <input type="hidden" name="id" value={detail.id} />
      <h3 className="m-0 text-[1.05rem] font-semibold">Ikat Subjek Pasien</h3>
      <p className="m-0 text-[0.88rem] text-[var(--label-2)]">Hanya dapat dilakukan satu kali sebelum verifikasi identitas.</p>
      <Notice state={state} />
      <label className={labelCls}>
        <span>ID Pasien</span>
        <input name="patient_id" type="text" required placeholder="UUID pasien" className={fieldCls} />
      </label>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Mengikat..." : "Ikat Pasien"}</Button>
      </div>
    </form>
  );
}

export function VerifyIdentityForm({ ctx, detail }: { ctx: RenderedContext; detail: DsrDetail }) {
  const [state, action, pending] = useActionState(verifyIdentityAction, {});
  if (detail.state === "closed" || detail.identityVerifiedAt) return null;
  const methods = IDENTITY_METHODS.filter((m) => identityMethodFits(detail.requester, m));
  return (
    <form action={action} className={cardCls}>
      <ContextFields ctx={ctx} />
      <input type="hidden" name="id" value={detail.id} />
      <h3 className="m-0 text-[1.05rem] font-semibold">Verifikasi Identitas Pemohon</h3>
      <Notice state={state} />
      <label className={labelCls}>
        <span>Metode verifikasi</span>
        <select name="method" defaultValue={methods[0]} className={fieldCls}>
          {methods.map((m) => (
            <option key={m} value={m}>{IDENTITY_METHOD_LABEL[m]}</option>
          ))}
        </select>
      </label>
      <div>
        <Button type="submit" disabled={pending}>{pending ? "Memverifikasi..." : "Verifikasi Identitas"}</Button>
      </div>
    </form>
  );
}

export function AssignDsrForm({ ctx, detail }: { ctx: RenderedContext; detail: DsrDetail }) {
  const [state, action, pending] = useActionState(assignDsrAction, {});
  if (detail.state === "closed" || !detail.identityVerifiedAt) return null;
  return (
    <form action={action} className={cardCls}>
      <ContextFields ctx={ctx} />
      <input type="hidden" name="id" value={detail.id} />
      <h3 className="m-0 text-[1.05rem] font-semibold">Tugaskan Petugas Privasi</h3>
      <Notice state={state} />
      <label className={labelCls}>
        <span>Petugas aktif</span>
        <select name="staff_id" defaultValue={detail.assignedTo ?? ""} className={fieldCls}>
          <option value="">Belum ditugaskan</option>
          {detail.officers.map((o) => (
            <option key={o.staffId} value={o.staffId}>{`${o.displayName} (${o.role === "owner" ? "Owner" : "Admin Pusat"})`}</option>
          ))}
        </select>
      </label>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Menyimpan..." : "Simpan Penugasan"}</Button>
      </div>
    </form>
  );
}

export function ConfirmCopyHandoffForm({ ctx, detail, options }: { ctx: RenderedContext; detail: DsrDetail; options: DsrLinkOptions }) {
  const [state, action, pending] = useActionState(confirmCopyHandoffAction, {});
  if (detail.state === "closed" || detail.right !== "access" || !detail.identityVerifiedAt || !detail.patientId) return null;

  return (
    <form action={action} className={cardCls}>
      <ContextFields ctx={ctx} />
      <input type="hidden" name="id" value={detail.id} />
      <h3 className="m-0 text-[1.05rem] font-semibold">Konfirmasi Serah Terima Salinan RME</h3>
      <p className="m-0 text-[0.88rem] text-[var(--label-2)]">
        Salinan RME yang baru diminta tidak dapat ditautkan sebelum artefak PDF (SHA-256) dan serah terimanya dikonfirmasi.
      </p>
      <Notice state={state} />
      <label className={labelCls}>
        <span>Permintaan salinan RME belum terkonfirmasi</span>
        {options.unconfirmedRecordCopies.length > 0 ? (
          <select name="copy_request_id" defaultValue={options.unconfirmedRecordCopies[0].id} className={fieldCls}>
            {options.unconfirmedRecordCopies.map((c) => (
              <option key={c.id} value={c.id}>{`Salinan ${c.id.slice(0, 8)} (${c.recordCount} berkas)`}</option>
            ))}
          </select>
        ) : (
          <input name="copy_request_id" type="text" required placeholder="UUID permintaan salinan RME" className={fieldCls} />
        )}
      </label>
      <label className={labelCls}>
        <span>SHA-256 artefak salinan PDF (64 karakter hex)</span>
        <input name="artifact_sha256" type="text" required pattern="[0-9a-fA-F]{64}" placeholder="64 karakter hex SHA-256 berkas PDF salinan" className={fieldCls} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelCls}>
          <span>Saluran serah terima salinan</span>
          <select name="handoff_channel" defaultValue="in_person" className={fieldCls}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          <span>Waktu serah terima salinan (WIB)</span>
          <input name="handed_off_at" type="datetime-local" step={1} required className={fieldCls} />
        </label>
        <label className={labelCls}>
          <span>Referensi tanda terima salinan</span>
          <input name="handoff_ref" type="text" required minLength={3} maxLength={200} placeholder="Contoh: SR-2026-01" className={fieldCls} />
        </label>
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Mengonfirmasi..." : "Konfirmasi Serah Terima Salinan"}</Button>
      </div>
    </form>
  );
}

export function LinkEvidenceForm({ ctx, detail, options }: { ctx: RenderedContext; detail: DsrDetail; options: DsrLinkOptions }) {
  const [state, action, pending] = useActionState(linkEvidenceAction, {});
  const allowed = allowedLinkKinds(detail);
  const [kind, setKind] = useState(allowed[0] ?? "record_copy");

  if (detail.state === "closed" || !detail.identityVerifiedAt || allowed.length === 0 || !detail.patientId) return null;

  const items =
    kind === "record_copy"
      ? options.recordCopies.map((x) => ({ id: x.id, label: `Salinan ${x.id.slice(0, 8)} · Ref ${x.handoffRef} (${x.recordCount} berkas)` }))
      : kind === "record_version"
        ? options.recordVersions.map((x) => ({ id: x.id, label: `Revisi RME v${x.version} (${x.id.slice(0, 8)})` }))
        : kind === "record_correction"
          ? options.recordCorrections.map((x) => ({ id: x.id, label: `Koreksi disetujui ${x.id.slice(0, 8)}` }))
          : options.consentWithdrawals.map((x) => ({ id: x.id, label: `Penarikan ${x.purpose} (${x.id.slice(0, 8)})` }));

  return (
    <form action={action} className={cardCls}>
      <ContextFields ctx={ctx} />
      <input type="hidden" name="id" value={detail.id} />
      <h3 className="m-0 text-[1.05rem] font-semibold">Tautkan Bukti Pemenuhan</h3>
      <Notice state={state} />
      <label className={labelCls}>
        <span>Jenis bukti</span>
        <select name="link_kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={fieldCls}>
          {allowed.map((k) => (
            <option key={k} value={k}>{LINK_KIND_LABEL[k]}</option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        <span>Catatan bukti (klaster pasien saat ini)</span>
        {items.length > 0 ? (
          <select name="link_id" defaultValue={items[0].id} className={fieldCls}>
            {items.map((it) => (
              <option key={it.id} value={it.id}>{it.label}</option>
            ))}
          </select>
        ) : (
          <input name="link_id" type="text" required placeholder="Belum ada kandidat — masukkan UUID bukti sah" className={fieldCls} />
        )}
      </label>
      {kind === "record_copy" && (
        <label className={labelCls}>
          <span>Referensi serah terima salinan (wajib)</span>
          <input name="handoff_ref" type="text" required minLength={3} maxLength={200} placeholder="Contoh: Tanda terima #SR-2026-01" className={fieldCls} />
        </label>
      )}
      {(kind === "record_version" || kind === "record_correction") && (
        <label className="inline-flex min-h-[var(--target)] items-center gap-2 text-[0.94rem]">
          <input type="checkbox" name="addresses_request" required className="h-5 w-5" />
          <span>Saya mengonfirmasi revisi klinis ini menjawab permintaan perbaikan pasien.</span>
        </label>
      )}
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Menautkan..." : "Tautkan Bukti"}</Button>
      </div>
    </form>
  );
}

export function CloseDsrForm({ ctx, detail }: { ctx: RenderedContext; detail: DsrDetail }) {
  const [state, action, pending] = useActionState(closeDsrAction, {});
  const availableOutcomes: Outcome[] = detail.identityVerifiedAt
    ? [...OUTCOMES].filter((o) => {
        if (detail.right === "erasure" && o === "fulfilled") return false;
        if (detail.right === "correction" && detail.correctionScope === "demographic" && o === "fulfilled") return false;
        return true;
      })
    : ["withdrawn"];
  const [outcome, setOutcome] = useState<Outcome>(availableOutcomes[0]);

  if (detail.state === "closed") return null;
  const bases = BASES_BY_OUTCOME[outcome];

  return (
    <form action={action} className={cardCls}>
      <ContextFields ctx={ctx} />
      <input type="hidden" name="id" value={detail.id} />
      <h3 className="m-0 text-[1.05rem] font-semibold">Tutup Permintaan</h3>
      <Notice state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          <span>Hasil</span>
          <select name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} className={fieldCls}>
            {availableOutcomes.map((o) => (
              <option key={o} value={o}>{OUTCOME[o]}</option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          <span>Dasar hukum / alasan terstruktur</span>
          <select name="outcome_basis_code" defaultValue={bases[0]} key={outcome} className={fieldCls}>
            {bases.map((b) => (
              <option key={b} value={b}>{OUTCOME_BASIS_LABEL[b]}</option>
            ))}
          </select>
        </label>
      </div>

      {outcome === "withdrawn" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>
            <span>Saluran pembatalan</span>
            <select name="withdrawal_source" defaultValue="in_person" className={fieldCls}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            <span>Atestasi petugas atas pembatalan (min. 5 huruf)</span>
            <input name="withdrawal_attestation" type="text" required minLength={5} maxLength={200} placeholder="Contoh: Pemohon membatalkan langsung di meja FO" className={fieldCls} />
          </label>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={labelCls}>
            <span>Saluran serah terima</span>
            <select name="delivery_channel" defaultValue="in_person" className={fieldCls}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            <span>Waktu konfirmasi serah terima (WIB)</span>
            <input name="delivery_confirmed_at" type="datetime-local" step={1} required className={fieldCls} />
          </label>
          <label className={labelCls}>
            <span>Referensi / bukti serah terima</span>
            <input name="delivery_ref" type="text" required minLength={3} maxLength={200} placeholder="No. tanda terima / atestasi serah terima" className={fieldCls} />
          </label>
        </div>
      )}

      <label className={labelCls}>
        <span>Catatan operasional singkat (opsional, tanpa data klinis, maks. 300 huruf)</span>
        <input name="outcome_note" type="text" maxLength={300} className={fieldCls} />
      </label>
      <div>
        <Button type="submit" variant={detail.identityVerifiedAt ? "default" : "secondary"} disabled={pending}>{pending ? "Menutup..." : "Tutup Permintaan"}</Button>
      </div>
    </form>
  );
}
