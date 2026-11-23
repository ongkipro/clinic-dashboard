"use client";
// Kurangi transparansi switch (HYG-NAV-1): a native checkbox exposed as a switch (keyboard and screen reader for free), applied at once.
// The value lives in localStorage (useSyncExternalStore: the server renders "off", the client reads the device value).
import { useId, useSyncExternalStore } from "react";
import { readReduce, writeReduce } from "./prefs";

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function ReduceTransparency() {
  const id = useId();
  const on = useSyncExternalStore(subscribe, () => readReduce(localStorage), () => false);
  return (
    <label htmlFor={id} className="flex min-h-[var(--target)] min-w-0 items-center justify-between gap-3 px-4">
      <span className="grid min-w-0">
        <span>Kurangi transparansi</span>
        <span className="text-[0.88rem] text-[var(--label-2)]">Bilah tab dan bilah atas tampil putih penuh, tanpa efek kaca.</span>
      </span>
      <input id={id} type="checkbox" role="switch" checked={on}
        onChange={(e) => { writeReduce(localStorage, document.documentElement, e.target.checked); listeners.forEach((l) => l()); }}
        className="size-6 shrink-0 accent-[var(--tint)]" />
    </label>
  );
}
