# UX Concept — "Apple-style" Mobile-first Clinic Dashboard

- **Rationale only: on any conflict, `DESIGN.md` and `10-DESIGN-SYSTEM-WHITELABEL.md` win; values in this file are historical.**
- Status: **Accepted direction 2026-11-02** (DECISION-REGISTER D-14 full Apple style, D-15 light only, D-16 tenant accent). Canonical tokens live in `DESIGN.md`, rules in `10`, screens in `17`; this file keeps the rationale, role IA, sketches and the HIG review. Dark appearance mentioned below is out of scope for Release 1.
- Method: Apple Human Interface Guidelines as packaged in `github.com/dickwu/apple-design-skill` (commit `ff4ebdd`, 2026-10-28; 123 HIG pages pulled from developer.apple.com). Pages read: `design-principles`, `designing-for-ios`, `designing-for-ipados`, `tab-bars`, `sidebars`, `split-views`, `layout`, `typography`, `color`, `liquid-glass`, `materials`, `sheets`, `toolbars`, `buttons`, `segmented-controls`, `lists-and-tables`, `searching`, `feedback`, `loading`, `modality`, `charts`, plus the skill's `cross-platform.md`. Citations use `file.md › Heading`.
- Inputs also used: the three kit reviews (`docs/research/reviews/review-1/2/3`), `BC-SCREEN-SPEC.md`, Kliniknuma `DESIGN.md`.
- Scope limit: the product is a **web app (Next.js PWA)**, not a native iOS app. Per the skill, web apps take Apple's principles and foundations (accessibility, color, type, layout, writing) fully, and its platform conventions (tab bar, sheets, toolbars) as patterns rebuilt in HTML. Apple trademarks, SF Pro font files and SF Symbols are not shipped (see §4.2, §4.6).

---

## 1. Thesis

**One sentence:** a clinic runs on the phone in a nurse's pocket and the iPad on the treatment trolley, so every role gets an app that feels like a native iPhone/iPad app: big readable type, a bottom tab bar, sheets for short tasks, and one visit timeline that everyone shares.

**Signature element — "Jalur Kunjungan" (visit track):** a single horizontal capsule on every patient screen showing the visit's independent states (Daftar · Pendampingan · Dokter · Pilihan · Persetujuan · Bayar · Persiapan · Tindakan · Serah · Selesai) as segments that fill in, with the one blocking item named in text under it ("Menunggu pembayaran tambahan Rp350.000"). It encodes the confirmed state separation (handoff §5, review-1 P2-3) instead of decorating. Everything else stays quiet.

**What it is not** (`SKILL.md` › craft lens, the three generated-UI looks): no warm cream + serif + terracotta; no near-black with an acid accent; no hairline broadsheet with zero radius. Not a desktop ERP squeezed onto a phone.

## 2. Apple principles applied (`design-principles.md`)

| Principle | Question | Answer in this concept |
|---|---|---|
| Purpose | What is each screen for? | One job per screen; the role's home tab shows only that role's next actions |
| Agency | Can people skip and recover? | Undo for reversible actions; corrections as new versions; drafts saved automatically |
| Responsibility | Is data use transparent? | Clinical data never on owner/cashier screens; consent shown where photos are taken |
| Familiarity | Platform patterns? | Tab bar, large titles, inset grouped lists, sheets with grabber, swipe actions, pull to refresh |
| Flexibility | Sizes, inputs, text sizes? | Size classes not devices; text scales to 200%; reduced motion/transparency; light only in Release 1 (D-15) |
| Simplicity | Has every element earned its place? | Max 5 tabs; one prominent button per view; secondary actions in a "Lainnya" menu |
| Craft | Spacing, wording finished? | 4-pt grid, Indonesian labels that say what happens |
| Delight | Right feeling? | Calm confidence; the visit track filling in is the only "moment" |

## 3. Platform and framework decisions

| Topic | Decision | HIG basis |
|---|---|---|
| App type | Installable PWA (Next.js), standalone display, safe-area aware (`env(safe-area-inset-*)`) | `layout.md` › Guides and safe areas |
| Layout keying | **Size classes by available width, not device**: compact < 700 px, regular ≥ 700 px; a second regular breakpoint at ≥ 1180 px for three panes | `layout.md` › Size classes: "Determine layout based on size classes, not device type or orientation" |
| Same functions at every size | Yes; only how much is visible changes | `layout.md` › Size classes: "Don't change your app's functionality based on the space it occupies" |
| Navigation | Compact: bottom tab bar (≤ 5). Regular: the same tabs as a sidebar (sidebar-adaptable pattern) | `tab-bars.md` › Best practices; `sidebars.md` › Mobile: "Consider using a tab bar first" |
| Detail views | Regular: split view (list + detail); ≥ 1180 px: optional third pane for history | `split-views.md` › Tablet |
| Short tasks | Bottom sheets with grabber, medium and large detents, swipe to dismiss, Cancel beside Done | `sheets.md` › Best practices |
| Long tasks | Full-screen modal (exam sheet, cashier) | `sheets.md`: "For complex or prolonged user flows, consider alternatives to sheets"; `modality.md` |
| Components | shadcn/ui primitives restyled to the tokens below; Drawer (vaul) for sheets with detents | `cross-platform.md` › Vocabulary |
| Android/desktop | Same layout; system font falls back to Roboto/Segoe; no glass on Android-class devices if performance drops | `liquid-glass.md` › React Native note (Android: prefer opaque) |

## 4. Design tokens (replace `DESIGN.md` tokens if accepted)

### 4.1 Color

Canonical values and contrast figures live in `DESIGN.md` › Tokens › Colour (light only, D-15). Changes from this concept's first draft, after recomputing contrast: `--label-2` became `#636366` (≥ 4.95:1 on every surface), `--control-border` became `#7C7C80` (3.73:1 on grouped background), dark-appearance values were dropped. Accent rules: `10-DESIGN-SYSTEM-WHITELABEL.md` UI-2.

### 4.2–4.5 Type, spacing, radius, materials, motion

Canonical values live in `DESIGN.md` (type scale with Dynamic Type wiring, 12 px groups, 44 px minimum targets, 120 ms press, 92% bar glass at 10 px blur). The earlier draft values in this section were removed to avoid conflicts.

## 5. Information architecture per role

Tabs ≤ 5, single-word Indonesian labels, never hidden or disabled (`tab-bars.md` › Best practices). Search lives in a tab or the top bar where search matters (`searching.md`). Settings and rarely used areas live under **Saya** (profile tab).

| Role | Tab 1 (home) | Tab 2 | Tab 3 | Tab 4 | Tab 5 |
|---|---|---|---|---|---|
| Front office / cashier | **Hari Ini** (visit board + outstanding) | Jadwal | Kasir | Pesan (WhatsApp) | Saya |
| BC | **Pasienku** (accompaniment queue) | Tindak Lanjut | Pesan | Target | Saya |
| Doctor | **Antrean** (ready for doctor) | Pasien | Permintaan (approvals: additions, plan change, substitution) | Keluhan (clinical complaints) | Saya |
| Nurse / therapist | **Ruang** (my room today) | Permintaan | Keluhan | — | Saya |
| Pharmacist | **Siapkan** (prep list) | Serahkan | Stok | Keluhan | Saya |
| Central CS | **Pesan** | Lead | Jadwal | Tindak Lanjut | Saya |
| Manager | **Ringkasan** | Hari Ini | Persetujuan | Stok | Saya |
| Owner | **Ringkasan** | Cabang | Persetujuan | Keuangan | Saya |
| Finance | **Keuangan** | Komisi | Laporan | — | Saya |

**Saya** contains: Komisi Saya, Target Saya, Jadwal Saya, Notifikasi, and (by role) Pengaturan › Klinik & Cabang, Staf, Katalog & Harga Cabang, Aturan, WhatsApp, SATUSEHAT, Log Audit, Permintaan Data Pasien, Ekspor Data. This adds the screens review-3 found missing (catalog, branch price override, approvals, own commission, clinical complaints, audit, data requests, export) without crowding tabs.

Regular width: the same tabs render as a sidebar on the left; sub-sections appear as a second sidebar level (max two levels, `sidebars.md`). Current location always highlighted (`split-views.md` › "persistently highlight the current selection").

## 6. Key screens (compact ↔ regular)

Wireframes are ASCII; `▮` = prominent (tinted) button, `▢` = secondary.

### 6.1 Front office — "Hari Ini"

```
COMPACT (iPhone)                          REGULAR (iPad landscape, ≥1180)
┌──────────────────────────┐              ┌────────┬──────────────────────┬───────────────────┐
│ Hari Ini      Cabang A ▾ │ large title  │Sidebar │ Hari Ini   Cabang A ▾│ Rina S. · 10:30   │
│ [Semua|Menunggu|Belum B.]│ segmented    │Hari Ini│ [Semua|Menunggu|...] │ ●●●●○○○○○○ track  │
│ ┌──────────────────────┐ │              │Jadwal  │ ┌──────────────────┐ │ Menunggu bayar    │
│ │⚠ Belum dibayar (2)   │ │ outstanding  │Kasir   │ │⚠ Belum dibayar 2 │ │ tambahan Rp350rb  │
│ │ Rina S.  Rp350.000 › │ │ always first │Pesan   │ │ Rina S.  350rb › │ │ ▮ Terima Pembayaran│
│ └──────────────────────┘ │              │Saya    │ ├──────────────────┤ │ ▢ Kirim tagihan WA │
│ 10:30 Rina S.            │ inset list   │        │ │10:30 Rina S.     │ │ Riwayat singkat   │
│ ●●●●○○○○○○  Dokter    ›  │ cell + track │        │ │●●●●○○○ Dokter    │ │ …                 │
│ 10:45 Dewi A.            │              │        │ │10:45 Dewi A.     │ │                   │
│ ●○○○○○○○○○  Datang    ›  │              │        │ └──────────────────┘ │                   │
│        ▮ Check-in        │ floating     │        │            ▮ Check-in│                   │
│ ┌────┬────┬────┬────┬──┐ │ glass tab bar└────────┴──────────────────────┴───────────────────┘
│ │Hari│Jadw│Kasi│Pesn│Sy│ │
└──────────────────────────┘
```

- Swipe a row left: "Panggil", "Tagih" (swipe actions on list rows, `designing-for-ios.md` › Best practices).
- Pull to refresh; live updates show "Baru sejak dimuat (3)" instead of reordering rows under the finger.
- Close visit: in the detail pane, enabled only when the track has no blocker; otherwise the blocker is written under the disabled button.

### 6.2 BC — accompaniment (from BC-SCREEN-SPEC, step model kept)

Compact: one patient = one full-screen flow with a 4-step header (Intake & Foto → Dokter → Diskusi Pilihan → Konfirmasi). Each step is an inset grouped form; the bottom bar holds one prominent action ("Kirim ke Dokter", "Konfirmasi & Kirim ke Kasir").
- Camera capture opens a full-screen sheet with the 3 required angles as a checklist.
- "Observasi kulit" uses chips (no scores, no Fitzpatrick) — review-3 F-10.
- Selection uses toggles per plan item; a sticky summary capsule shows "Bayar sekarang Rp1.200.000 · Saldo Rp200.000".
- "BC Pembimbing" label (review-3 F-13).

### 6.3 Doctor — examination (iPad first)

Regular ≥ 1180: three panes — Antrean | Lembar Pemeriksaan | Riwayat (history, photos with comparability flag). Compact/portrait: Riwayat becomes a medium-detent sheet that keeps the edit state (`sheets.md` › "consider supporting the medium detent").
- Intake items as rows with accept/correct swipe (no retyping).
- Face map full width of the middle pane, layer switcher as a segmented control (Keluhan | Pemeriksaan | Tindakan) — `segmented-controls.md`: "switch between closely related subviews".
- One prominent "Tanda Tangani" in the toolbar (`toolbars.md` › "Use the prominent style for key actions such as Done or Submit. Only specify one primary action").
- **Permintaan** tab: additions, plan changes, substitutions as cards with "Setujui" / "Tolak" + reason — closes review-3 F-4.

### 6.4 Room — treatment checklist (tablet on trolley, gloved hands)

```
┌──────────────────────────────────────┐
│ Ruang Tindakan 2      ⏱ 12:40        │
│ Rina S. · Laser Toning  ●●●●●●●○○○   │
│ ┌ Sebelum mulai ───────────────────┐ │
│ │ ✓ Identitas cocok                │ │  50 px rows, checkbox on the right
│ │ ✓ Persetujuan tindakan ada       │ │
│ │ ✓ Bahan diterima (3)           › │ │
│ └──────────────────────────────────┘ │
│  ▢ Bahan tambahan   ▢ Usul tambahan  │
│        ▮▮  Selesai Tindakan  ▮▮      │  50 px capsule
└──────────────────────────────────────┘
```
"Selesai Tindakan" opens a medium sheet: outcome as four large options (Selesai sesuai rencana / Berhenti — alasan medis / Berhenti — kendala klinik / Pasien berhenti), then material deviations only. Timer end never completes anything.

### 6.5 Cashier

Full-screen modal from a visit: items list (frozen prices, tax badge), then a tender sheet with large amount keypad, tender chips (Tunai, QRIS, EDC, Transfer, Link, Saldo) and the remaining amount in Title 1. One prominent "Terima Rp…" whose label states the amount (`buttons.md` › "Ensure that each button clearly communicates its purpose").

### 6.6 Owner — "Ringkasan" (phone first)

```
┌──────────────────────────┐
│ Ringkasan     Semua ▾    │
│ Perlu ditangani          │ exceptions first (hidden when none)
│  3 persetujuan        ›  │
│  2 kunjungan belum bayar›│
│ ──────────────────────── │
│ Uang masuk hari ini      │ Title 1 value, delta with ▲▼ and word
│ Rp 18,4 jt  ▲ 12% vs Sen │
│ Layanan selesai Rp 15,1 jt│
│ Kewajiban prabayar Rp 92 jt│
│  └ Paket kedaluwarsa 30 hr Rp 6 jt │ packages only (review-1 P3-4)
│ [Minggu ini line chart]  │ uang masuk vs layanan selesai
│ Cabang ▸ (league list)   │
└──────────────────────────┘
```
Charts: title states the finding, data table available, never color alone (`charts.md` › "Avoid relying solely on color"; "Summarize the main message").

### 6.7 WhatsApp inbox

Mirrors Messages: conversation list with branch chip and SLA timer; thread with a bottom composer; when the 24-hour window is closed the composer is replaced by "Pilih template" (no free text). "Tandai keluhan klinis" in the message's context menu creates a clinical task (review-3 F-3).

### 6.8 Public booking (patient)

Four steps in one flow: Cabang → Layanan → Waktu → Nomor WhatsApp (OTP). Large tappable time chips, sticky summary, one primary button per step. Opaque top bar (no glass on content-heavy marketing pages), no floating WhatsApp button, no tracking before consent (PR-39).

## 7. Review of the current kit through the Apple lenses

Ratings follow the skill's report format. Findings already raised in reviews 1–3 are not repeated except where Apple's guidelines change the fix.

**Summary — Needs work.** The current `DESIGN.md`/`17` describe a desktop-first admin ("Klinik Lapang") with a 240 px rail, 14 px body text and tables. Staff actually work on phones and tablets; the kit has no compact navigation model, no sheet model, no dark appearance, and text below platform defaults.

| Severity | What | Why (citation) | Fix |
|---|---|---|---|
| Critical | Body 14 px, table 13 px, micro-label 12 px on clinical tablets | `typography.md` › default 17 pt iOS, min 11 pt; review-3 F-12 | §4.2 scale (Body 17 px) |
| Critical | Input border `#CBD5E1` 1.48:1 | Non-text contrast ≥ 3:1 (`accessibility.md`, `color.md`) | `--control-border` `#7C7C80` 4.16:1 on white, 3.73:1 on grouped |
| High | No navigation model for compact width (rail → drawer only) | `tab-bars.md` › "Use a tab bar to support navigation"; `sidebars.md` › "Consider using a tab bar first" | §5 tab bars per role, sidebar-adaptable on regular |
| High | Breakpoints keyed to devices (tablet 768–1023, desktop 1366+) leaving 1024–1365 undefined | `layout.md` › Size classes: "not device type or orientation" | compact < 700, regular ≥ 700, three-pane ≥ 1180 |
| High | No increased-contrast plan (dark appearance deferred by owner decision D-15) | `SKILL.md` › Lens 2 "light and dark appearance … semantic colors" | Increased-contrast tokens in DESIGN.md; dark appearance a later release |
| High | Short tasks specified as drawers/pages, long tasks as sheets inconsistently | `sheets.md`, `modality.md` | §3: sheets for short, full-screen modal for exam and cashier |
| Medium | Several prominent actions per screen in UX contracts (e.g. "Tagih / Setujui") | `toolbars.md` › one prominent action; `buttons.md` › "Use style — not size — to distinguish the preferred choice" | One ▮ per view; others ▢ or in "Lainnya" |
| Medium | Feedback described as toasts/banners for routine actions | `feedback.md` › integrate status into the interface | Inline status on the row/visit track |
| Medium | Titles like "Buka pengecualian" | `writing.md` (via `SKILL.md` Lens 5): labels say what happens | "Lihat yang perlu ditangani" |
| Medium | Chart-4 `#CC79A7` 2.85:1 on canvas | `charts.md` › accessibility; non-text 3:1 | `#B5568C` 4.49:1 |
| Low | "Bilik" reads Malaysian; "BC Pendamping" conflicts with BC spec | Review-3 F-13 | "Ruang Tindakan", "BC Pembimbing" |

**Craft notes.** The current direction has a reason (bright clinic rooms) but no signature; the "Jalur Kunjungan" track gives it one tied to the product's core rule (independent visit states). Remove one accessory: the serif display face is not needed in staff screens — the system font carries everything; brand lives in the tenant accent and the patient-facing booking photo.

**What works and stays:** single-sheet exam (no cards in cards), status = color + shape + word, provenance badges, no clinical content on boards, 44 px targets, Indonesian-first labels.

## 8. Quality floor (must pass before UI is called done)

- Text at 200% at 390/820/1180/1440 px (NFR-4) without truncation of essential content.
- Contrast numbers in `DESIGN.md` re-checked in light appearance and with increased contrast.
- Every icon-only control has an accessible name; keyboard focus visible (`--tint` 2 px ring, 5.85:1).
- Reduced motion and reduced transparency honored.
- One prominent action per view; tabs never hidden or disabled; current location always visible.
- Browser checks at 390 (iPhone), 820 and 1180 (iPad portrait/landscape), 1440 (desktop) via `ui-validation`; public booking also `dotuiux check`.

## 9. Owner decisions

Decided 2026-11-02: full Apple style (D-14), light only (D-15), tenant accent with validation (D-16). `DESIGN.md`, `10` and `17` rewritten accordingly.
