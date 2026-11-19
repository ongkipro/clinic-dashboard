// Labels of Jurnal & Buku Besar (UX-22 ▸ Buku Besar; T-105). Clinic glossary; no store words. Statements are generic by class (not SAK-labelled).
import type { AccountClass, Entry, LedgerStatus } from "../../../../modules/accounting/ledger/ledger";

export const CLASS: Record<AccountClass, string> = { asset: "Aset", liability: "Kewajiban", equity: "Ekuitas", revenue: "Pendapatan", expense: "Beban" };
export const KIND: Record<Entry["kind"], string> = { auto: "Otomatis", manual: "Manual", reversal: "Pembalik" };
export const EVENT: Record<string, string> = {
  PaymentAllocated: "Pembayaran dialokasikan", TreatmentFinished: "Tindakan selesai", SessionRedeemed: "Sesi paket digunakan", ConsultationFeeCharged: "Biaya konsultasi",
  ProductHandedOver: "Produk diserahkan", BalanceToppedUp: "Isi saldo", BalanceMoved: "Pindah ke saldo", ReceivableCreated: "Piutang dibuat",
  ReceivableCollected: "Piutang dilunasi", ReceivableWrittenOff: "Piutang dihapusbukukan", BookingDepositReceived: "DP diterima", BookingDepositApplied: "DP diterapkan",
  BookingDepositForfeited: "DP hangus", BookingDepositRefunded: "DP dikembalikan", RefundPaid: "Refund tunai", ProductReturned: "Produk dikembalikan",
  StockConsumed: "Bahan dipakai", StockWasted: "Bahan terbuang", CommissionAccrued: "Komisi diakui", CommissionAdjusted: "Komisi dikoreksi", CommissionPaid: "Komisi dibayar",
  StockTransferred: "Transfer stok antarcabang", GoodsReceived: "Barang diterima", SupplierInvoiceRecorded: "Tagihan pemasok", ExpenseRecorded: "Biaya dicatat",
  ExpenseReversed: "Biaya dibatalkan", SupplierPaymentAllocated: "Pembayaran pemasok", SupplierPaymentReversed: "Pembayaran pemasok dibatalkan",
  SupplierReturned: "Retur ke pemasok", SupplierCreditApplied: "Nota kredit pemasok", InvoiceVoided: "Invoice dibatalkan", SupplierInvoiceReversed: "Tagihan pemasok dibatalkan",
  SupplierCreditReversed: "Nota kredit dibatalkan", ManualJournalPosted: "Jurnal manual", GatewaySettlementReceived: "Settlement gateway",
};
export const eventLabel = (e: string) => EVENT[e] ?? e;
// The books' status line (Panel 2 G4 / E1–E2): never "official" in T-105.
export function statusText(s: LedgerStatus): { title: string; detail: string } {
  if (s.state === "active") return { title: "Buku aktif", detail: `Peta posting ${s.map_version}` };
  const why = s.map_signed ? "Peta posting sudah disetujui akuntan; aktivasi buku belum diputuskan." : "Peta posting belum ditandatangani akuntan.";
  return { title: "Pratinjau — bukan buku resmi", detail: `${why} Jurnal otomatis memakai peta posting draf ${s.map_version}.` };
}
export const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
export const day = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
