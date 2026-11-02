# Round 4 review B — navigation and page catalogue (19)

- Reviewer: cc/claude-opus-5-5 via direct pi run (read only), 2026-11-02.

## Verdict: **PASS-WITH-FIXES**

The tree's structure is sound and most of it traces back to the research. Five P1 problems need fixing before sign-off:

1. There is no page for managing services and the treatment catalogue (Master Layanan).
2. Pengaturan has a settings registry but no place in the navigation tree.
3. Who may change settings contradicts the 07 role matrix.
4. Ten items are deferred to R1.1, which conflicts with P-21.
5. SET-35 (FO idle lock) is adjustable here but fixed in IAM-7.

All of these are document edits, not design rework. I did not read 17 (screen contracts) or the PLAN CD-* decisions, so I trusted the CD-* defaults without checking them. Some thin pages may already be covered in 17.

## Findings

| ID | Sev | Evidence | Problem | Smallest fix |
|---|---|---|---|---|
| F1 | P1 | Research §5.2 Pengaturan "Master layanan/treatment"; 19 §2 has none; SET-4 only | There is no catalogue page. The research lists category, durations, required room/device, allowed staff, branch price, tax class, BHP recipe, consent template and aftercare text per service. Kalender, Kasir, Konfirmasi BHP ("sesuai formula"), Pengingat & Aftercare and Situs all depend on this data. | Add a **Master Layanan** page (list + detail with ▸ Umum · Durasi & Sumber Daya · Staf · Harga Cabang · Pajak · Resep BHP · Persetujuan · Aftercare). Roles: Admin Pusat (no price override), Owner, facility head (clinical review), pharmacist (materials), matching the 07 "Catalog" row. |
| F2 | P1 | 19 §5 "grouped exactly as the Pengaturan menu shows"; §2 has no Pengaturan group | Pengaturan has no route, no group and no role list. Phone users can't find it. | Add §2.17 Pengaturan with one page per group (Klinik & Cabang … Laporan) and roles per group. Each group page shows only the SET rows the role may change. |
| F3 | P1 | 07 "Tenant/branch settings": Admin Pusat ◐ **drafts**, Facility head –, Pharmacist –, Marketing – vs SET-2/3/4/8/16–19/23/32/33/36 (Admin Pusat "Changed by"), SET-28–31 (facility head), SET-26 (pharmacist, purchasing), SET-36 (marketing); IAM-11 "settings drafts" | Settings authority contradicts 07 in both directions. It is unclear whether Admin Pusat changes settings directly or drafts them for Owner to publish. | Pick one model per SET group. Then add a "Changes / Drafts / Approves" column to §5, or split 07's settings row per SET group. If drafts → Owner, show that flow on the Pengaturan page. |
| F4 | P1 | IAM-7 "120 s idle (**fixed default**, B-16)" vs SET-35 60–600 s, owner, branch | The same rule is fixed in 07 and adjustable in 19. | Either remove SET-35 (keep it class F), or change IAM-7 and record a decision. Recommendation: keep it fixed, since it is a security control. |
| F5 | P1 | Owner decision P-21; 19 marks Daftar Tunggu, Insiden, Logbook, Kode Promo, Kampanye, Survei, Rekonsiliasi, Biaya, Jurnal, Kirim Laporan as R1.1 | "No narrowing", yet 10 research items are deferred. Voucher & promo is **bold consensus** in research §5.2, and Biaya operasional is not even marked advanced. | Move them to R1, or list each deferral as an owner-approved exception with its reason (e.g. Kampanye waiting on Q-15 legal; Insiden handled by manual SOP). |
| F6 | P2 | 07 Complaint tasks: Manager "–"; 19 Keluhan ▸ Layanan (manager), Ringkasan Cabang "keluhan", Survei "→ tugas manager" | Manager handles service complaints in 19 but has no complaint capability in 07. | In 07, add Manager ◐ (service complaints only, no clinical content). |
| F7 | P2 | 19 Rencana Perawatan "BC (view)"; Pendampingan "Diskusi Pilihan"; 07 BC "Examination, plan" – ; "Clinical content never visible to non-clinical roles" | BC sees the plan, but 07 gives no plan access to BC. | In 07, add a row "Plan options & prices (no assessment)": BC ◐. In 19, define the BC projection as items, stages and prices only. |
| F8 | P2 | 19 Pengingat & Aftercare roles "Admin Pusat, CS"; 07 Templates & reminder rules: Central CS – , Manager ◐, Marketing ◐ | CS can edit reminder rules in 19 but not in 07. Manager and marketing are missing from 19. | Give CS a send log only (read). Add Manager (clinical aftercare text) and Marketing to 19. |
| F9 | P2 | IAM-4 "verified by someone other than inviter"; 07 Staff: facility head ◐ (clinical verification), Manager ◐; 19 Data Staf "Owner, Admin Pusat" | No role in 19 can verify STR/SIP credentials. | Add a ▸ Verifikasi Kredensial tab for the facility head, and Manager (view own branch). |
| F10 | P2 | 07 Patient identity: Admin Pusat, facility head, records officer, doctor, nurse, therapist, pharmacist, finance ◐/●; 19 Daftar Pasien "FO, CS, BC, manager, owner" | Clinical roles and the records officer can't search patients, even though Gabung Data Ganda needs the records officer. | List every 07 role and define the columns each one sees. |
| F11 | P2 | 07 Dashboards: Marketing ◐ (K13, K14), Pharmacist ◐, Purchasing ◐ (K18), Auditor ◐, FO ◐, Doctor ◐; research §6 has homes for Therapist, Pharmacist, Marketing, Cashier and Doctor | Seven roles have no Ringkasan (home) page. Doctor home lacks unsigned records, follow-ups due and contraindication flags. | Name the home page per role: e.g. Pharmacist → Siapkan + near-expiry/BUD widget; Marketing → Ringkasan Marketing; Therapist → Ruang + "Komisi Saya". Add the missing doctor widgets to Antrean Dokter. |
| F12 | P2 | Research §6 Owner: Average ticket, no-show %, new vs returning, alerts (big void/refund, cash variance, credential expiry, low rating), "send digest"; Manager alerts: overbooked, late doctor, calibration due; Finance: tax summary, unreconciled, lock period | The dashboards drop the research alerts and primary actions. | Add an "Alerts" and "Primary actions" line to each 2.1 row. |
| F13 | P2 | 19 §2.2 Layar Antrean "tanpa nama pasien (default)"; no SET row | Says "default" but there is no matching setting. Showing names on a TV at an aesthetic clinic is a privacy (UU PDP) exposure. | Make this class F: number only. If initials are wanted, add a bounded SET row. Also add the voice-call and portrait/landscape options from research §7.14. |
| F14 | P2 | SET-5 / SET-6 bounds "≥ 0" | A Rp0 branch price or consultation fee works as a 100% discount without discount approval, a money-integrity bypass. | Lower bound > 0. Free items go through the discount/exemption flow only. |
| F15 | P2 | SET-33 numbering "Format pattern", Admin Pusat | Changing the invoice or RM format mid-period risks gaps or renumbering, which matters for tax, audit and RME. | Make sequential, gap-free, never-reused numbering class F. Format can change only before the first document or at the start of a period. Past numbers are immutable. |
| F16 | P2 | SET-30 delegation "Clinical review" | No legal floor is stated, so a clinic could delegate injections to a therapist. | Bound the setting by a fixed legal table (class F), and allow only narrowing. Changes need facility head and owner, each a different person from the requester. |
| F17 | P2 | SET-22 single bound 14–365 for two values | There is no cross-field rule, and changing it silently alters KPI K11/K10 definitions. | Require second-visit window < dormant window. Version the setting in Kamus KPI and show "definition changed" on trend charts. |
| F18 | P2 | NAV-2 "Saya opens the full tree" vs §2.16 Saya (user menu) | "Saya" means two different things. On phone, a list of about 95 entries has no search. | Rename the last tab **Menu** (full tree + search + pinned/recent), and keep Saya as the profile section at its top. Add the research's ⌘K command palette on desktop. Allow collapsing the sidebar to icons on tablet so the doctor's 3-column workspace fits. |
| F19 | P2 | Thin pages (see list below) | Many rows are a single noun phrase, with no fields, actions or states. | For each row, add: key fields/columns, primary action, approval hook, and the empty/blocked state. Or point to the exact 17 section. |
| F20 | P2 | Research §7.4/§7.6/§7.8 | Key screen content is missing: <br>• Lembar Pemeriksaan: vitals, skin assessment (Fitzpatrick), dose per point on the face map, Tindakan & BHP auto-priced "send to cashier", autosave, lock after signing, PIN/OTP signature. <br>• Kasir: VA tender, credit card type, next-appointment suggestion after payment, backdate approval, offline policy. <br>• Paket: share with family, package refund request. | Add these to the content cells. |
| F21 | P3 | 19 uses "Cashier" and "FO" separately; 07 has one FO/cashier column; "Display device" and "Staff (demo)" are not 07 roles | Role vocabulary doesn't match across the two documents. | Use the 07 role names. Define how a display device is paired (scoped token with no patient data). |
| F22 | P3 | Pages listed in two groups: Ringkasan Keuangan, Jadwal Staf, Piutang (Kasir and Keuangan), Tagihan Server (Keuangan and Saya) | It's unclear whether these are one route or two, and the §6 count (~95) double-counts them. | Mark them "same route, second entry point" and recount. |
| F23 | P3 | Defaults with no source: SET-16 (30 days / 2 h), SET-13 (self-labelled "value proposal"), SET-19 (on close vs research aftercare H+1), SET-6 (shows only "CD-01", no value) | Defaults can't be traced to research. | Cite a source or mark them "owner decision pending". Put the actual value in each cell. |
| F24 | P3 | Bounds: SET-4 allows a 0-minute treatment; SET-18/23/25/29 "—"; SET-31 default "hari yang sama" is not a duration; SET-12 "10% atau Rp500.000" is ambiguous | Bounds are vague or don't make sense. | SET-4: treatment 5–480, prep/buffer 0–120. Give reminder times a bounded window (e.g. 08:00–20:00). Use 8 h for "same day". Define SET-12 as "whichever is lower". |
| F25 | P3 | SET-8/9/24 are package-template or commission-rule fields | Catalogue data is mixed in with settings. | Keep only tenant defaults in SET and edit the rest on their own pages. |
| F26 | P3 | Research "AI summary", "Booking grup/korporat", "Referral" | These are neither covered nor listed as deliberate exclusions. | Add them to the exclusion list or to the tree. |

## Missing pages / content

- **Master Layanan** (catalogue + BHP recipe + consent and aftercare per service): P1.
- **Pengaturan** section in the navigation tree: P1.
- **Cabang** (branch master): licence/izin klinik, NIB, PJ, address, SATUSEHAT org ID. Research §5.2 "Profil klinik & cabang"; SET-1 has name/logo only.
- **Pengguna & Hak Akses**: read-only permission matrix per role, active sessions, permission-change log (research §7.13).
- **Privasi & Persetujuan**: consent purposes ledger, processors, **breach register** (IAM-13 grants it, but no page exists).
- **Manajemen Approval** view: who approves what, with thresholds.
- Gudang/depot within a branch, and transfers between depots (research "Gudang/depot").
- Logbook: hazardous medical waste (limbah B3) entries (research §5.2).
- Piutang: installment schedule (cicilan/termin).
- Komisi: payout status (research §7.10).
- Ulasan Google management (research "Ulasan Google & survei"); "Ulasan" tab in the patient profile.
- Situs Klinik admin editor (currently only "Lihat §4").
- BC package simulator / quote (research §4.2 BC "package simulator"; 07 BC ◐ quote).
- Target & KPI per staf for roles other than BC; staff scorecard.
- Reports missing: churn, top spender, LTV; sales per shift; doctor activity; pharmacy waiting time; campaign/promo performance; satisfaction.
- Otomasi missing: H-3 reminder, H+7/H+14 follow-up, product refill reminder.
- Home pages for Pharmacist, Marketing, Therapist/Nurse, Purchasing and Auditor (F11).
- Display antrian config: voice call, portrait/landscape.
- Kamus KPI (definitions page referenced by the reports).

## Missing settings

- **Tax:** PKP status (owner-entered fact), tax class per item, rounding rule. The PPN rate itself stays fixed (class F).
- **Payments:** payment link expiry, MDR/fee per method (research "Metode pembayaran & biaya"), installment rules (max count/tenor), whether backdating is allowed and who approves.
- **Kebijakan:** no-show policy (no-shows before DP becomes required; DP forfeiture %), cancellation/refund policy text, DP refund rules.
- **Saldo/DP expiry** (Aesta "Jumlah Bulan DP Expired"). Recommendation: make "no expiry" class F unless legal advice says otherwise.
- **Packages:** sharing with family on/off; swap rule (value-based).
- **Approval matrix:** void approver and time window, opname variance threshold, stock adjustment, PO approval threshold, refund-to-saldo approver.
- **Alert thresholds:** waiting alert "X menit" (Ringkasan Cabang currently undefined), near-expiry stock warning days, STR/SIP expiry warning days, low-stock alert.
- **Queue:** numbering prefix per counter, voice call on/off.
- **Online booking:** which services are bookable online, DP required for new patients, fee for choosing a specific staff member (optional).
- **Communication:** WA quiet hours, lead auto-assignment (round-robin or manual), aftercare and follow-up offsets.
- **Commission:** basis (before or after discount) and when it is earned (on payment or on delivery). This needs an explicit default plus prospective-only changes.
- **Other:** session timeout for non-FO devices and tablets, signature method (PIN or OTP), receipt paper size per branch, week start and fiscal period, piutang aging buckets.
- **Privacy:** consent purpose texts. Retention periods stay fixed by law.

## Should be fixed rules (class F), not settings

- SET-35 idle lock (per IAM-7)
- Gap-free document numbering (part of SET-33)
- Legal floor of the delegation matrix (SET-30)
- Branch price / consultation fee > 0 (SET-5, SET-6)
- No patient names on the queue TV
- PPN rate
- RME retention period

## Good

- Every page maps to a UX-* screen and has a release tag, and settings trace to SET-*, PR-38 and B-24.
- The registry has strong rules: values are versioned, transactions keep the value they used, bounds are enforced server-side, every change is audited with old/new value, and "Kembalikan ke default" restores the researched default.
- Owner-only money powers (price override, cash refund, discount limits) match IAM-11.
- The exclusions are applied consistently: no loyalty, gift cards, kiosk, shop or courier. The public site correctly has no promo or testimonial pages.
- Privacy details are handled well: receipt WA link without treatment names, clinical tabs hidden by role (* markers), auditor and purchasing views masked.
- The money controls are thorough: VisitTrack blockers, "Belum dibayar" shown first, void → approval, shift close with variance reason.
- The vendor console is complete and separate from the clinic app.
