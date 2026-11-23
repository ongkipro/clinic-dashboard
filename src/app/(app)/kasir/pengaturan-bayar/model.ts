// Pembayaran (port), pure (HYG-NAV-2): labels and the one status line the owner reads.
export const PROVIDER_LABEL: Record<string, string> = { mock: "Simulasi (gateway tiruan)" };
export const ENV_LABEL: Record<string, string> = { production: "Produksi", staging: "Staging", demo: "Demo", local: "Lokal" };
export const CHANNEL_LABEL: Record<string, string> = { qris: "QRIS", va: "Virtual Account", payment_link: "Link Bayar" };
export type PortStatus = { kind: "none"; canEnableMock: boolean } | { kind: "mock"; simulated: true } | { kind: "inactive" };
export function portStatus(ports: readonly { provider: string; active: boolean }[], env: string): PortStatus {
  const active = ports.find((p) => p.active);
  if (active) return { kind: "mock", simulated: true };
  if (ports.length > 0) return { kind: "inactive" };
  return { kind: "none", canEnableMock: env !== "production" };
}
