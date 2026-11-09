"use client";
// Kredensial forms (UX-3, PR-73; T-050): Tambah Kredensial sheet (Owner, Admin Pusat), Verifikasi / Tolak and
// Tangguhkan / Cabut on each credential. Every form carries a fresh idempotency key and the rendered context.
import { useActionState, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "../../../components/ui/drawer";
import type { RenderedContext } from "../../../modules/org/context/context";
import { type CredentialActionState, decideCredentialAction, endCredentialAction, recordCredentialAction } from "./kredensial-actions";
import { KIND_LABEL, KIND_PROFESSIONS, PROFESSION_LABEL } from "./kredensial-labels";

function Message({ state }: { state: CredentialActionState }) {
  if (state.error) return <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>;
  if (state.ok) return <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{state.ok}</p>;
  return null;
}
const field = "grid min-w-0 gap-1.5";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
// A fresh idempotency key per attempt (review r1 P1-2): the action bumps state.n on every answer and the
// Key remounts with it; a retry of the same submission before an answer reuses it.
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}


export function RecordCredentialSheet({ staffId, branches, replaceable, ctx }: {
  staffId: string; branches: { id: string; name: string }[]; replaceable: { id: string; label: string }[]; ctx: RenderedContext;
}) {
  const [state, action, pending] = useActionState<CredentialActionState, FormData>(recordCredentialAction, {});
  const [kind, setKind] = useState("str");
  const [profession, setProfession] = useState("dokter");
  const professions = KIND_PROFESSIONS[kind];
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button>Tambah Kredensial</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Tambah Kredensial</DrawerTitle>
          <DrawerDescription>STR berlaku seumur hidup bila tanpa tanggal berakhir. SIP, SIPP dan SIPA berlaku untuk satu cabang dan selalu punya tanggal berakhir.</DrawerDescription>
        </DrawerHeader>
        {/* Fields scroll; the footer with Simpan stays visible (review r1 P2-3). */}
        <form action={action} className="grid min-h-0 grid-rows-[1fr_auto]">
          <div className="grid max-h-[50vh] gap-4 overflow-y-auto px-4 pb-2">
          <ContextFields ctx={ctx} />
          <Key key={state.n ?? 0} />
          <input type="hidden" name="staff_id" value={staffId} />
          <label className={field}>
            <span className="font-semibold">Jenis</span>
            <select className={input} name="kind" value={kind} onChange={(e) => {
              setKind(e.target.value);
              if (!KIND_PROFESSIONS[e.target.value].includes(profession)) setProfession(KIND_PROFESSIONS[e.target.value][0]);
            }}>
              {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className={field}>
            <span className="font-semibold">Profesi</span>
            <select className={input} name="profession" value={professions.includes(profession) ? profession : professions[0]} onChange={(e) => setProfession(e.target.value)}>
              {professions.map((v) => <option key={v} value={v}>{PROFESSION_LABEL[v]}</option>)}
            </select>
          </label>
          <label className={field}>
            <span className="font-semibold">Nomor</span>
            <input className={input} name="number" required minLength={3} maxLength={60} autoComplete="off" />
          </label>
          <label className={field}>
            <span className="font-semibold">Penerbit</span>
            <input className={input} name="issuer" required minLength={3} maxLength={120} placeholder="mis. Dinas Kesehatan Kota" />
          </label>
          {kind !== "str" && (
            <label className={field}>
              <span className="font-semibold">Cabang</span>
              <select className={input} name="branch_id" required defaultValue="">
                <option value="" disabled>Pilih cabang</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <label className={field}>
            <span className="font-semibold">Berlaku sejak</span>
            <input className={input} name="valid_from" type="date" required />
          </label>
          <label className={field}>
            <span className="font-semibold">Berlaku sampai{kind === "str" ? " (kosongkan bila seumur hidup)" : ""}</span>
            <input className={input} name="expires_on" type="date" required={kind !== "str"} />
          </label>
          <label className={field}>
            <span className="font-semibold">Lingkup (opsional)</span>
            <input className={input} name="scope" maxLength={200} />
          </label>
          <label className={field}>
            <span className="font-semibold">Letak dokumen (opsional)</span>
            <input className={input} name="evidence_note" maxLength={300} placeholder="mis. Map kepegawaian, lemari arsip" />
          </label>
          {replaceable.length > 0 && (
            <label className={field}>
              <span className="font-semibold">Menggantikan (perpanjangan)</span>
              <select className={input} name="replaces" defaultValue="">
                <option value="">Bukan perpanjangan</option>
                {replaceable.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
          )}
          <Message state={state} />
          </div>
          <DrawerFooter>
            <Button type="submit" size="lg" aria-disabled={pending}>{pending ? "Menyimpan…" : "Simpan Kredensial"}</Button>
            <DrawerClose asChild>
              <Button variant="plain" type="button">Tutup</Button>
            </DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

export function DecideCredential({ id, staffId, ctx }: { id: string; staffId: string; ctx: RenderedContext }) {
  const [state, action, pending] = useActionState<CredentialActionState, FormData>(decideCredentialAction, {});
  const [rejecting, setRejecting] = useState(false);
  return (
    <form action={action} className="grid gap-2">
      <ContextFields ctx={ctx} />
      <Key key={state.n ?? 0} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="staff_id" value={staffId} />
      {rejecting ? (
        <>
          <label className={field}>
            <span className="font-semibold">Alasan penolakan</span>
            <input className={input} name="reason" required minLength={3} maxLength={500} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="verdict" value="rejected" variant="destructive" aria-disabled={pending}>Tolak Kredensial</Button>
            <Button type="button" variant="plain" onClick={() => setRejecting(false)}>Batal</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="verdict" value="verified" aria-disabled={pending}>Verifikasi</Button>
          <Button type="button" variant="secondary" onClick={() => setRejecting(true)}>Tolak</Button>
        </div>
      )}
      <Message state={state} />
    </form>
  );
}

export function EndCredential({ id, staffId, canSuspend, ctx }: { id: string; staffId: string; canSuspend: boolean; ctx: RenderedContext }) {
  const [state, action, pending] = useActionState<CredentialActionState, FormData>(endCredentialAction, {});
  const [open, setOpen] = useState<"suspended" | "revoked" | null>(null);
  if (!open) {
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          {canSuspend && <Button type="button" variant="secondary" onClick={() => setOpen("suspended")}>Tangguhkan</Button>}
          <Button type="button" variant="plain" className="text-[var(--danger)]" onClick={() => setOpen("revoked")}>Cabut</Button>
        </div>
        <Message state={state} />
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-2">
      <ContextFields ctx={ctx} />
      <Key key={state.n ?? 0} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="staff_id" value={staffId} />
      <input type="hidden" name="state" value={open} />
      <p className="m-0 text-[0.94rem] text-[var(--label-2)]">
        {open === "suspended"
          ? "Kredensial yang ditangguhkan langsung tidak berlaku. Untuk memakai lagi, catat kredensial baru yang diverifikasi ulang."
          : "Kredensial yang dicabut tidak bisa dipulihkan."}
      </p>
      <label className={field}>
        <span className="font-semibold">Alasan</span>
        <input className={input} name="reason" required minLength={3} maxLength={500} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" aria-disabled={pending}>{open === "suspended" ? "Tangguhkan Kredensial" : "Cabut Kredensial"}</Button>
        <Button type="button" variant="plain" onClick={() => setOpen(null)}>Batal</Button>
      </div>
      <Message state={state} />
    </form>
  );
}
