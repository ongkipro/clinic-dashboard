"use client";
// Forms of Staf & Undangan and Pengguna & Akses (UX-3). Each submits one server action
// and shows its message (10 State Copy Patterns: short past tense on success).
import { useActionState, useState } from "react";
import { Button } from "../../../components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../../../components/ui/drawer";
import {
  type ActionState,
  cancelInviteAction,
  dutyAction,
  endMembershipAction,
  inviteAction,
  removeRoleAction,
  revokeSessionAction,
} from "../../../modules/org/staff/actions";

function Message({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>;
  if (state.ok) return <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{state.ok}</p>;
  return null;
}

const field = "grid min-w-0 gap-1.5";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";

export function InviteSheet({ roles, branches }: { roles: { value: string; label: string; branch: boolean }[]; branches: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button>Undang</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Undang Staf</DrawerTitle>
          <DrawerDescription>Staf membuat kata sandinya sendiri dari tautan undangan.</DrawerDescription>
        </DrawerHeader>
        <form action={action} className="grid max-h-[60vh] gap-4 overflow-y-auto px-4">
          <label className={field}>
            <span className="font-semibold">Nama</span>
            <input className={input} name="name" required minLength={2} maxLength={120} autoComplete="off" />
          </label>
          <label className={field}>
            <span className="font-semibold">Email</span>
            <input className={input} name="email" type="email" required autoComplete="off" />
          </label>
          <fieldset className="m-0 grid gap-1 border-0 p-0">
            <legend className="mb-1 font-semibold">Peran</legend>
            {roles.map((r) => (
              <label key={r.value} className="flex min-h-[var(--target)] items-center gap-3">
                <input type="checkbox" name="roles" value={r.value} className="size-5" />
                {r.label}
              </label>
            ))}
          </fieldset>
          <fieldset className="m-0 grid gap-1 border-0 p-0">
            <legend className="mb-1 font-semibold">Cabang (untuk peran cabang)</legend>
            {branches.map((b) => (
              <label key={b.id} className="flex min-h-[var(--target)] items-center gap-3">
                <input type="checkbox" name="branches" value={b.id} className="size-5" />
                {b.name}
              </label>
            ))}
          </fieldset>
          <Message state={state} />
          {state.link && (
            <div className="grid gap-2">
              <input className={`${input} font-mono text-[0.82rem]`} readOnly value={state.link} aria-label="Tautan undangan" />
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(state.link!);
                  setCopied(true);
                }}
              >
                {copied ? "Tautan disalin" : "Salin Tautan"}
              </Button>
            </div>
          )}
          <DrawerFooter className="px-0">
            <Button type="submit" size="lg" aria-disabled={pending}>
              {pending ? "Menyimpan…" : "Buat Undangan"}
            </Button>
            <DrawerClose asChild>
              <Button variant="plain" type="button">Tutup</Button>
            </DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

export function CancelInvite({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelInviteAction, {});
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="plain" aria-disabled={pending}>Batalkan</Button>
      <Message state={state} />
    </form>
  );
}

export function RevokeSession({ staffId, sessionId, label }: { staffId: string; sessionId?: string; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(revokeSessionAction, {});
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="staff" value={staffId} />
      <input type="hidden" name="session" value={sessionId ?? ""} />
      <Button type="submit" variant="destructive" aria-disabled={pending}>{label}</Button>
      <Message state={state} />
    </form>
  );
}

export function RemoveRole({ staffId, role, label }: { staffId: string; role: string; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(removeRoleAction, {});
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="staff" value={staffId} />
      <input type="hidden" name="role" value={role} />
      <Button type="submit" variant="plain" aria-disabled={pending}>{`Cabut ${label}`}</Button>
      <Message state={state} />
    </form>
  );
}

export function EndMembership({ staffId }: { staffId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(endMembershipAction, {});
  const [confirm, setConfirm] = useState(false);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="staff" value={staffId} />
      {confirm ? (
        <>
          <p className="m-0">Akhiri keanggotaan? Semua sesi staf ini dicabut dan riwayatnya tetap tersimpan.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="plain" onClick={() => setConfirm(false)}>Batal</Button>
            <Button type="submit" variant="destructive" aria-disabled={pending}>Akhiri Keanggotaan</Button>
          </div>
        </>
      ) : (
        <Button type="button" variant="destructive" onClick={() => setConfirm(true)}>Akhiri Keanggotaan</Button>
      )}
      <Message state={state} />
    </form>
  );
}

export function DutyToggle({ staffId, duty, assigned, label }: { staffId: string; duty: string; assigned: boolean; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(dutyAction, {});
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="staff" value={staffId} />
      <input type="hidden" name="duty" value={duty} />
      <input type="hidden" name="assign" value={assigned ? "0" : "1"} />
      <Button type="submit" variant={assigned ? "plain" : "secondary"} aria-disabled={pending}>
        {assigned ? `Akhiri ${label}` : `Tugaskan ${label}`}
      </Button>
      <Message state={state} />
    </form>
  );
}
