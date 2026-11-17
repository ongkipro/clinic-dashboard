// The QRIS payment instruction as a scannable QR code (review r1 P1), encoded on the server from the provider's EMVCo payload by the local
// encoder (no external QR service). The payload text stays available below the code for apps that accept a pasted code.
import { encodeQr, qrPath } from "../../../../modules/vendor/billing/qr";

export function QrisCode({ payload, label }: { payload: string; label: string }) {
  let path: { size: number; d: string } | null = null;
  try {
    path = qrPath(encodeQr(payload));
  } catch {
    path = null;
  }
  return (
    <div className="grid min-w-0 gap-2">
      <p className="m-0">Pindai kode QRIS ini dengan aplikasi bank atau dompet digital:</p>
      {path ? (
        <svg role="img" aria-label={label} viewBox={`0 0 ${path.size} ${path.size}`} shapeRendering="crispEdges"
          className="h-auto w-full max-w-[16rem] rounded-[var(--radius-field)] bg-white">
          <rect width={path.size} height={path.size} fill="#fff" />
          <path d={path.d} fill="#000" />
        </svg>
      ) : (
        <p className="m-0" role="alert">Kode QRIS tidak dapat ditampilkan. Gunakan kode teks di bawah.</p>
      )}
      <details className="min-w-0">
        <summary className="inline-flex min-h-[var(--target)] cursor-pointer items-center font-semibold">Tampilkan kode teks</summary>
        <pre tabIndex={0} className="m-0 min-w-0 overflow-auto whitespace-pre-wrap rounded-[var(--radius-field)] bg-white p-2 text-[0.82rem] [overflow-wrap:anywhere]">{payload}</pre>
      </details>
    </div>
  );
}
