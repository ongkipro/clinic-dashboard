"use client";
// UX-32 Ekspor Data interactive forms (PR-52; T-122).
// Both request and download embed ContextFields and require fresh HYG-026 TOTP step-up.
// Download posts via POST /ekspor/[id]/unduh (never GET/prefetch, never credential in URL).
import { useActionState, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { requestExportAction, type ExportActionState } from "./actions";
import { downloadHref } from "./model";

const fieldCls =
  "min-h-[var(--target)] w-full max-w-[16rem] rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-[1rem] text-[var(--label)]";

export function StartExportForm({ ctx }: { ctx: RenderedContext }) {
  const [state, action, pending] = useActionState<ExportActionState, FormData>(requestExportAction, {});
  const [key, setKey] = useState(() => crypto.randomUUID());

  return (
    <form
      action={(fd) => {
        if (state.ok) setKey(crypto.randomUUID());
        return action(fd);
      }}
      className="grid min-w-0 gap-3"
    >
      <ContextFields ctx={ctx} />
      <input type="hidden" name="key" value={key} />
      {(state.error || state.ok) && (
        <p
          role={state.error ? "alert" : "status"}
          className={`m-0 rounded-[var(--radius-field)] px-3 py-2 text-[0.94rem] ${
            state.error ? "bg-danger-soft text-destructive" : "bg-success-soft text-success"
          }`}
        >
          {state.error ?? state.ok}
        </p>
      )}
      <label className="grid gap-1 text-[0.94rem] font-medium text-[var(--label)]">
        <span>Kode autentikator 6 digit (TOTP)</span>
        <input
          name="totp_code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          placeholder="123456"
          className={fieldCls}
        />
      </label>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Meminta ekspor..." : "Mulai Ekspor"}
        </Button>
      </div>
    </form>
  );
}

export function DownloadExportForm({ ctx, exportId }: { ctx: RenderedContext; exportId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDownloading(true);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await fetch(downloadHref(exportId), { method: "POST", body: fd });
      if (!res.ok) {
        let msg = "Ekspor tidak dapat diunduh.";
        try {
          const body = (await res.json()) as { message?: string };
          if (typeof body.message === "string" && body.message.trim()) msg = body.message;
        } catch {
          // non-JSON fallback
        }
        setError(msg);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(cd);
      const fileName = m?.[1] ?? `ekspor-${exportId.slice(0, 8)}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Koneksi gagal saat mengunduh ekspor. Coba lagi.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <form method="post" action={downloadHref(exportId)} onSubmit={onSubmit} className="grid gap-2 pt-1">
      {error && (
        <p role="alert" className="m-0 rounded-[var(--radius-field)] bg-danger-soft px-3 py-2 text-[0.94rem] text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <ContextFields ctx={ctx} />
        <label className="grid gap-1 text-[0.88rem] font-medium text-[var(--label)]">
          <span>Kode TOTP untuk unduh (opsional jika masih baru)</span>
          <input
            name="totp_code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            placeholder="123456"
            className={fieldCls}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={downloading}>
          {downloading ? "Mengunduh..." : "Unduh ZIP"}
        </Button>
      </div>
    </form>
  );
}
