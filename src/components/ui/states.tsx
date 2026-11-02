// UI-5 state patterns (10 §State Copy Patterns). Copy is passed in by the screen; these
// components fix the shape: loading is a skeleton with no text, empty states carry one
// action, errors carry recovery, blocked states say why and who can unblock.
import { cn } from "cn";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  // Static: DESIGN.md allows no looping animation.
  return <div aria-hidden="true" className={cn("rounded-[var(--radius-field)] bg-[var(--surface-2)]", className)} />;
}

export function LoadingList({ rows = 3, label = "Memuat" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="grid gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[52px]" />
      ))}
    </div>
  );
}

function Panel({ children, role }: { children: React.ReactNode; role?: "status" | "alert" }) {
  return (
    <div role={role} className="grid justify-items-start gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
      {children}
    </div>
  );
}

// "Belum ada {objek}." + primary action
export function EmptyState({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return (
    <Panel role="status">
      <p className="m-0 text-[var(--label-2)]">{message}</p>
      {action && <Button onClick={onAction}>{action}</Button>}
    </Panel>
  );
}

// "Tidak ada {objek} untuk filter ini." + "Hapus Filter"
export function FilteredEmptyState({ message, onClear }: { message: string; onClear?: () => void }) {
  return (
    <Panel role="status">
      <p className="m-0 text-[var(--label-2)]">{message}</p>
      <Button variant="plain" onClick={onClear}>Hapus Filter</Button>
    </Panel>
  );
}

// TD-51 message + "Coba Lagi"
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Panel role="alert">
      <p className="m-0 text-destructive">{message}</p>
      <Button variant="plain" onClick={onRetry}>Coba Lagi</Button>
    </Panel>
  );
}

// "Anda tidak memiliki akses ke {objek}."
export function PermissionState({ object }: { object: string }) {
  return (
    <Panel role="status">
      <p className="m-0 text-[var(--label-2)]">Anda tidak memiliki akses ke {object}.</p>
    </Panel>
  );
}

// "{alasan}. {siapa} dapat {membuka}."
export function BlockedState({ reason, unblock }: { reason: string; unblock: string }) {
  return (
    <Panel role="status">
      <p className="m-0">
        <span className="font-semibold">{reason}.</span> <span className="text-[var(--label-2)]">{unblock}.</span>
      </p>
    </Panel>
  );
}

// Short past tense, no exclamation.
export function SuccessNotice({ message }: { message: string }) {
  return (
    <p role="status" className="m-0 rounded-[var(--radius-field)] bg-success-soft px-3 py-2 text-success">
      {message}
    </p>
  );
}
