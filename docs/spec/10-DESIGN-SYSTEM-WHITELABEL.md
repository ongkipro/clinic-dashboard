# UI Design System and White-labeling — Clinic Dashboard

## Document Control

| Field | Value |
|---|---|
| Owner | Design owner |
| Status | In Review |
| Version / updated | kit v0.7 / 2026-11-02 (history: review rounds 1–5, `docs/research/reviews/`) |
| Applies to | Staff app (all roles, phone/tablet/desktop), vendor console (desktop), patient public site and booking, receipts and printouts |
| Companion | `DESIGN.md` (canonical token values), `UX-CONCEPT-APPLE-STYLE.md` (rationale, IA, sketches) |
| Decisions | DECISION-REGISTER D-14 (full Apple style), D-15 (light only), D-16 (tenant accent), D-17 (terms) |
| Source | Apple HIG (rules captured in this kit; original source `github.com/dickwu/apple-design-skill` @ff4ebdd, optional); Kliniknuma DESIGN.md (reference only) |

## Purpose

Every role uses the product on a phone or iPad during clinical work. The UI follows Apple's Human Interface Guidelines as patterns rebuilt for the web: familiar navigation and sizes, readable type, quiet screens, one clear action. Tenants change only the accent colour, logo and public photos.

## Visual Direction

| Dimension | Accepted direction | Evidence/source | Consequence | Local override boundary |
|---|---|---|---|---|
| Platform feel | Native iPhone/iPad conventions on the web | D-14; HIG `designing-for-ios.md`, `designing-for-ipados.md` | Tab bars, large titles, inset grouped lists, sheets | None |
| Appearance | Light only | D-15 | One token set | None |
| Brand | Tenant accent on selected tab, primary button, links; logo on public pages and Saya | D-16; HIG `branding.md` via skill: brand colour on primary actions and status only | Accent validated (UI-2) | Accent, logo, clinic name, public photo |
| Signature | Jalur Kunjungan visit track | UX concept §1 | One component, reused on all patient screens | None |

## Requirements

| ID | Requirement | Owner | Verification | Status |
|---|---|---|---|---|
| UI-1 | Text contrast ≥ 4.5:1 below 18 px (≥ 3:1 for ≥ 18 px or bold ≥ 14 px); UI boundaries and chart marks ≥ 3:1; values in `DESIGN.md` are the floor | Design owner | Contrast test over all token pairs | Proposal |
| UI-2 | Tenant accent is accepted only if accent on white, accent on grouped, accent on derived soft and accent on bar glass over black (`#EBEBEB`) are each ≥ 4.5:1; failures show the ratio and a nearer compliant shade | Design owner | Accent validation test | Proposal |
| UI-3 | Status always uses colour + symbol + Indonesian word | Design owner | Component test | Proposal |
| UI-4 | Touch targets ≥ 44 × 44 px with ≥ 8 px gaps; clinical-room cells 52 px; primary buttons 50 px | Design owner | Browser geometry check | Proposal |
| UI-5 | Every screen has loading (skeleton), first-run empty, filtered-empty, error with recovery, success, and blocked-with-reason states | Design owner | Browser check per screen | Proposal |
| UI-6 | Money as `Rp` integer rupiah via `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })`; times with branch zone label (WIB/WITA/WIT); never mixed units in one total | Design owner | TEST-LOC-1 | Proposal |
| UI-7 | Provenance badges distinguish Laporan Pasien, Catatan BC (belum diverifikasi), Observasi Staf, Terverifikasi Dokter, Ditandatangani | Clinical lead | Component test | Proposal |
| UI-8 | Tenant theming limited to: accent (UI-2), logo SVG/PNG ≤ 200 KB, clinic name ≤ 60 chars, public hero photo JPEG/WebP ≤ 500 KB; no custom CSS or scripts | Security owner | Upload validation test | Proposal |
| UI-9 | Components are shadcn/ui (via CLI) restyled to `DESIGN.md` tokens; sheets use the Drawer primitive with detents; no second component library | Engineering owner | Dependency check | Proposal |
| UI-10 | Public booking passes `dotuiux check` floor gates; staff screens pass `ui-validation` at 390, 820, 1180 and 1440 px | Design owner | Check reports | Proposal |
| UI-11 | Navigation: compact width uses a bottom tab bar of ≤ 5 tabs with labels ≤ 2 words and ≤ 13 characters, never hidden or disabled; regular width shows the same items as a leading sidebar (max two levels); the current location is always highlighted | Design owner | Browser check | Proposal |
| UI-12 | Type follows the iOS Dynamic Type "Large (default)" scale in rem (body 17 px, minimum 11 px for tab labels only); iOS Dynamic Type wired via `font: -apple-system-body`; layouts survive 200% text without hiding essential content | Design owner | Browser check at 200% and iPad Dynamic Type check | Proposal |
| UI-13 | Only one prominent (tinted) action per view; destructive actions are never the prominent style and always offer Cancel | Design owner | Screen review | Proposal |
| UI-14 | Glass/blur (≤ 10 px, fill ≥ 92% white) appears only on the tab bar, scrolled top bar and sheet header; an in-app "Kurangi transparansi" option and `prefers-contrast: more` make them opaque | Design owner | Browser check | Proposal |
| UI-15 | Short focused tasks use sheets (grabber, medium/large detents, swipe-down to dismiss, Cancel beside Done, unsaved-change confirmation); long tasks (examination, cashier, BC flow) use full-screen modals | Design owner | Screen review | Proposal |
| UI-16 | Patient public site uses one template per tenant with the same tokens and system font; tenant changes only accent, logo, clinic name and hero photo (UI-8); no carousel; first screen = clinic name, one line, concern/branch chips, one "Buat Janji" action; compact width shows a sticky bar with labelled "Buat Janji" and "WhatsApp"; clinical-clarity direction (real clinic photos, facts per treatment, no pastel blobs or model-face defaults) | Design owner | `dotuiux check` + browser check 390/1280 | Proposal |
| UI-17 | Vendor console is desktop-first (≥ 1280 px primary), sidebar navigation, data tables allowed; same tokens; a persistent coloured banner marks any active support session in a tenant | Design owner | Browser check 1280/1440 | Proposal |
| UI-18 | Simulated payments (mock adapter) show a "SIMULASI" banner on every page, receipt and invoice, using `--warning` with symbol and word (UI-3) | Design owner | Browser check | Proposal |

## Token Architecture

| Layer | Examples | Tenant-overridable? |
|---|---|---|
| Primitive | greys, status hues | No |
| Semantic | `--bg`, `--bg-grouped`, `--surface`, `--label`, `--label-2`, `--control-border`, status pairs | No |
| Accent | `--tint`, `--on-tint`, `--tint-soft` | Yes (UI-2) |
| Component | button, cell, sheet, tab bar, badge | No direct override |

## Component Contract (core set)

| Component | Purpose | Notes |
|---|---|---|
| TabBar / Sidebar | Role navigation (UI-11) | Badge only for critical counts |
| LargeTitleHeader | Screen title collapsing on scroll; trailing toolbar items | One prominent item max |
| InsetGroupedList / Cell | Lists and forms | Swipe actions on rows (compact); chevron for drill-in |
| Sheet | Short tasks (UI-15) | Drawer with detents |
| SegmentedControl | 2–5 closely related views or filters | Text only |
| SearchField | Top of list screens; Pasien search in its own tab where search is primary | |
| VisitTrack | Jalur Kunjungan capsule + blocker text | Segments: Daftar, Pendampingan, Dokter, Pilihan, Persetujuan, Bayar, Persiapan, Tindakan, Serahkan, Selesai; each segment state (selesai, berjalan, terblokir, tidak perlu) has a symbol and an accessible name such as "Langkah 4 dari 10: Dokter — menunggu" |
| PatientHeader | Name, age, alerts (allergy, pregnancy, contraindication), balance, receivable | Alerts use danger tone with symbol |
| ExamSheet | Single white sheet with collapsible sections | Locked after signing |
| FaceMapStudio | Five templates × three layers; layer switch by segmented control | Accessible table sync |
| TreatmentChecklist | Before / during / finish; outcome sheet | 52 px rows |
| PrepList | Pharmacy preparation from approved selections | |
| TenderSheet | Amount keypad, tender chips, remaining amount in Title 1 | |
| ConversationView | WhatsApp thread; composer swaps to template picker outside the 24 h window | |
| KpiRow | Label, value, delta with ▲▼ and words, time basis | No gauges |
| StatusBadge | Colour + symbol + word | |
| ApprovalCard | Request, requester, reason, Setujui/Tolak | Requester ≠ approver shown |

## State Copy Patterns (UI-5)

| State | Pattern (Bahasa Indonesia) | Example |
|---|---|---|
| Loading | Skeleton only; no text | — |
| First-run empty | "Belum ada {objek}." + primary action | "Belum ada pasien. Daftarkan Pasien" |
| Filtered empty | "Tidak ada {objek} untuk filter ini." + "Hapus Filter" | "Tidak ada janji untuk filter ini." |
| Error (recoverable) | TD-51 message + "Coba Lagi" | "Koneksi terputus. Coba Lagi" |
| Error (permission) | "Anda tidak memiliki akses ke {objek}." | — |
| Blocked action | "{alasan}. {siapa} dapat {membuka}." | "Belum dibayar. Kasir dapat menerima pembayaran." |
| Waiting approval | "Menunggu persetujuan {peran}." | "Menunggu persetujuan Owner." |
| Success | Short past tense, no exclamation | "Pembayaran diterima." |
| Destructive confirm | "{Aksi} {objek}? {akibat}." + "Batal" / "{Aksi}" | "Batalkan janji? DP dipindah ke saldo." |
| Offline / outage | "Tidak terhubung. Perubahan disimpan dan dikirim saat koneksi kembali." (only where offline-safe) | — |

## Indonesian Glossary

| Concept | UI term | Loanword allowed |
|---|---|---|
| Treatment room | Ruang Tindakan | — |
| Pre-assembled tray | Nampan Tindakan | — |
| External-use compounded label | Etiket Biru | — |
| Opened vial | Vial Terbuka (Batas Pakai) | — |
| Face map | Peta Wajah & Tubuh | — |
| Examination sheet | Lembar Pemeriksaan | — |
| Care plan | Rencana Perawatan | — |
| BC skin notes | Observasi Kulit | — |
| Patient balance | Saldo Pasien | — |
| Booking deposit | DP Booking | yes (DP) |
| Walk-in patient | Pasien Datang (tanpa janji) | — |
| Queue number | Nomor Antrean | — |
| Aftercare | Perawatan Setelah Tindakan | — |
| Server fee (vendor) | Biaya Server | — |
| Support session | Sesi Dukungan | — |
| Head office admin | Admin Pusat | — |
| Store words to avoid | Not used: Keranjang, Checkout, Pesanan, Pembeli, Pengiriman (P-13) | — |
| Receivable | Piutang Pasien | — |
| Package session | Sesi Paket (Siap Dipakai, Terkunci, Dipesan, Terpakai) | — |
| Guiding / closing BC | BC Pembimbing / BC Closing | yes (Closing) |
| Additional treatment | Tindakan Tambahan | — |
| Consultation fee waived | Konsultasi Gratis | — |
| Free control | Kontrol Gratis | — |
| Exceptions to handle | Perlu Ditangani | — |
| Lead | Lead | yes |
| Inbox | Pesan | — |
| Check-in | Check-in | yes |

## White-label Capability Matrix

| Capability | Allowed values | Validation | Fallback | Audit event |
|---|---|---|---|---|
| Accent | One hex | UI-2 ratios | Default `#0A6E86` | `branding.accent_changed` |
| Logo | SVG/PNG ≤ 200 KB, ≤ 512 px | Type, size, SVG sanitizing | Clinic name text | `branding.logo_changed` |
| Clinic name | ≤ 60 chars | Plain text | Tenant legal name | `branding.name_changed` |
| Public hero photo | JPEG/WebP ≤ 500 KB | Type, size, EXIF stripped | No photo | `branding.hero_changed` |
