// UI-3: status is colour + symbol + Indonesian word, never colour alone.
import { cn } from "cn";
import { CircleCheck, Clock, Lock, OctagonAlert, PencilLine, TriangleAlert } from "lucide-react";

const TONES = {
  success: { className: "bg-success-soft text-success", Icon: CircleCheck },
  warning: { className: "bg-warning-soft text-warning", Icon: Clock },
  danger: { className: "bg-danger-soft text-destructive", Icon: OctagonAlert },
  locked: { className: "bg-locked-soft text-locked", Icon: Lock },
  neutral: { className: "bg-neutral-soft text-neutral", Icon: PencilLine },
  blocked: { className: "bg-danger-soft text-destructive", Icon: TriangleAlert },
} as const;

export type StatusTone = keyof typeof TONES;

export function StatusBadge({ tone, children, className }: { tone: StatusTone; children: string; className?: string }) {
  const { className: toneClass, Icon } = TONES[tone];
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.82rem] font-semibold leading-5",
        toneClass,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
      {children}
    </span>
  );
}
