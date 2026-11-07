"use client";
// Checklist rows with their edit form (UX-41) and Tandai Siap Live (PR-59). Buttons appear only for
// roles that may use them; the database decides again and names a go-live blocker when it refuses.
import { useState } from "react";
import type { ChecklistItem } from "../../../../modules/vendor/checklist/checklist";
import { ITEM_LABEL } from "../../../../modules/vendor/checklist/labels";
import { post } from "../../_lib/post";
import s from "../../_lib/console.module.css";

const STATUS: Record<ChecklistItem["status"], { label: string; tone: string }> = {
  open: { label: "Belum selesai", tone: s.toneWarning },
  done: { label: "Selesai", tone: s.toneSuccess },
  not_applicable: { label: "Tidak dipakai", tone: s.toneNeutral },
};
const OPTIONAL = new Set(["payment_port", "waba", "satusehat"]);

export function ChecklistEditor(p: { tenantId: string; items: ChecklistItem[]; staff: { id: string; name: string }[]; editable: boolean; label: string }) {
  return (
    <ul className={`${s.cards} ${s.cardsAlways}`} aria-label={p.label}>
      {p.items.map((i) => (
        <Row key={`${i.branch_id ?? "t"}:${i.item}`} tenantId={p.tenantId} item={i} staff={p.staff} editable={p.editable} />
      ))}
    </ul>
  );
}

function Row({ tenantId, item, staff, editable }: { tenantId: string; item: ChecklistItem; staff: { id: string; name: string }[]; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const st = STATUS[item.status];
  const id = `${item.branch_id ?? "t"}-${item.item}`;
  const title = ITEM_LABEL[item.item] ?? item.item;
  return (
    <li className={s.card}>
      <div className={s.header}>
        <p className={s.cardTitle}>{title}</p>
        <span className={`${s.badge} ${st.tone}`}>{st.label}</span>
      </div>
      <dl className={s.cardMeta}>
        <dt>Penanggung jawab</dt>
        <dd>{item.owner ?? "Belum ditentukan"}</dd>
      </dl>
      {item.note && <p className={s.boxMuted}>{item.status === "open" ? "Kendala: " : "Catatan: "}{item.note}</p>}
      {error && (
        <p className={s.alert} role="alert">
          {error}
        </p>
      )}
      {editable && !open && (
        <div className={s.actions}>
          <button type="button" className={s.plain} onClick={() => setOpen(true)} aria-label={`Ubah ${title}`}>
            Ubah
          </button>
        </div>
      )}
      {editable && open && (
        <form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError(undefined);
            const r = await post("checklist-set", {
              tenantId, branchId: item.branch_id, item: item.item,
              status: String(f.get("status") ?? ""), note: String(f.get("note") ?? "").trim(), ownerId: String(f.get("owner") ?? "") || null,
            });
            setBusy(false);
            if (!r.ok) return setError(r.message);
            window.location.reload();
          }}
        >
          <div className={s.field}>
            <label className={s.label} htmlFor={`${id}-status`}>
              Status
            </label>
            <select className={s.input} id={`${id}-status`} name="status" defaultValue={item.status}>
              <option value="open">Belum selesai</option>
              <option value="done">Selesai</option>
              {OPTIONAL.has(item.item) && <option value="not_applicable">Tidak dipakai klinik ini</option>}
            </select>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor={`${id}-owner`}>
              Penanggung jawab
            </label>
            <select className={s.input} id={`${id}-owner`} name="owner" defaultValue={item.owner_id ?? ""}>
              <option value="">Belum ditentukan</option>
              {staff.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor={`${id}-note`}>
              Kendala atau catatan
            </label>
            <textarea className={s.input} id={`${id}-note`} name="note" rows={2} maxLength={500} defaultValue={item.note ?? ""} aria-describedby={OPTIONAL.has(item.item) ? `${id}-help` : undefined} />
            {OPTIONAL.has(item.item) && (
              <p className={s.help} id={`${id}-help`}>
                &quot;Tidak dipakai&quot; butuh alasan (3–500 karakter).
              </p>
            )}
          </div>
          <div className={s.actions}>
            <button type="submit" className={s.primary} aria-disabled={busy}>
              Simpan
            </button>
            <button type="button" className={s.plain} onClick={() => setOpen(false)}>
              Batal
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function GoLive({ tenantId, ready }: { tenantId: string; ready: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!ready) {
    return (
      <button type="button" className={s.primary} aria-disabled="true" aria-describedby="golive">
        Tandai Siap Live
      </button>
    );
  }
  return (
    <form
      className={s.fieldset}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(undefined);
        const r = await post("tenant-advance", { tenantId, to: "live", reason: String(new FormData(e.currentTarget).get("reason") ?? "").trim() });
        setBusy(false);
        if (!r.ok) return setError(r.message);
        window.location.reload();
      }}
    >
      {error && (
        <p className={s.alert} role="alert">
          {error}
        </p>
      )}
      <div className={s.field}>
        <label className={s.label} htmlFor="golive-reason">
          Catatan
        </label>
        <input className={s.input} id="golive-reason" name="reason" defaultValue="Ceklis onboarding lengkap, klinik siap melayani" minLength={10} maxLength={500} required />
      </div>
      <button type="submit" className={s.primary} aria-disabled={busy}>
        Tandai Siap Live
      </button>
    </form>
  );
}
