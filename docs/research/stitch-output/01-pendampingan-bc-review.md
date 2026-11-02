# Review — Stitch output: Pendampingan BC (2026-10-31)

Basis: HTML pasted by the user (code reading only; not rendered in a browser). Compared against confirmed decisions in the discovery checkpoint and the proposed BC field list.

## Matches
- Patient header with allergy badge, balance, active package; BC Pembimbing shown.
- Intake labelled "belum diverifikasi dokter — bukan diagnosis".
- Four photo slots (3 filled, close-up empty).
- Doctor plan read-only with doctor name and time; staged plan; patient selection checkboxes; total Rp 5.485.000 (arithmetic correct); minimum DP callout; Tunda/Tolak; footer actions.
- Primary action uses #0B6E7D; font Inter.

## Must fix (rule or scope conflicts)
1. Skin analysis contains clinical findings outside BC scope: lesion grade, TEWL/hydration %, lesion distribution, PIH with anatomical terms. BC is non-medical; device measurement is deferred. Keep only skin type, sensitivity, and a note.
2. Doctor plan is labelled "Draft dr", yet the BC can proceed to payment. The plan must be approved before patient selection.
3. Special conditions (pregnant, breastfeeding, current medication, allergy reported) appear only as free text. Make them structured, patient-reported fields.
4. Minimum DP shows Rp 1.000.000 while Serum Acne (a product) is selected. Open rule: a product handed over today probably has to be paid in full (DP = Rp 1.285.000). Needs a decision.
5. No consultation-fee status (free because of purchase) and no outstanding balance in the header.

## Missing
- Photo consent: clinical use and marketing use separately.
- Per-item defer/decline with reason (only whole-plan buttons exist).
- Note to doctor when the patient wants a change.
- Closing BC and patient source.
- Short history (last visit, active package sessions, next control).
- State-dependent actions: before the doctor only "Kirim ke Dokter"; after approval only "Lanjut ke Persetujuan & Kasir".
- Required-field markers.

## Minor
- Captions at 10–11 px are too small for all-day use; minimum 12 px.
- Stitch shifted the palette (primary #005460, secondary blue #406182); navy #002B49 is unused.
- Sample dates 2024; "Utama" branch badge is unexplained; branch switcher is not interactive.
- Photos are AI-generated and hot-linked from Google; they may expire.
