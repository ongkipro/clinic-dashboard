# M9 J11 Walkthrough — Patient Finds Clinic Online (Pre-Staging Status)

Status: PENDING EXECUTION (manual owner staging walkthrough deferred under `DEC-034`; automated contract tests pass across `docs/evidence/m9/m9-flow.test.ts` [2 J11 pure-contract checks: public site/unpublished price/neutral WA & pixel CSP policy] and the owning suites cited per step below)

## Automated Coverage Verified on `5210d969`

- `docs/evidence/m9/m9-flow.test.ts` directly exercises 2 J11 pure-contract checks: public site branch/treatment snapshot with hidden unpublished price + neutral booking/WhatsApp links (`PR-64`/`PR-65`/`PR-67`) and strict zero-pixel/replay CSP on health-intent & booking routes (`PR-39`).
- Individual J11 steps are covered by their owning integration suites on `5210d969`:
  - `J11-1`: `tests/public/site.test.ts`, `docs/evidence/m9/m9-flow.test.ts`
  - `J11-2`: `tests/public/rules.test.ts`, `docs/evidence/m9/m9-flow.test.ts`
  - `J11-3`: `tests/public/doctors.test.ts`
  - `J11-4`: `tests/public/booking.spec.ts`, `docs/evidence/m9/m9-flow.test.ts`
  - `J11-5`: `tests/public/pixels.spec.ts`, `docs/evidence/m9/m9-flow.test.ts`
  - `J11-6`: `tests/public/site.test.ts`, `tests/public/booking.spec.ts` (`publicState()` neutral refusal)

## Manual Owner Staging Walkthrough Checklist (Pending Staging Provisioning — `DEC-034`)

Run on synthetic staging `BOOKING_HOST` over real HTTPS before signing off:

| Step | Action | Expected | Sign-off |
|---|---|---|---|
| J11-1 | Open `https://<BOOKING_HOST>/<slug>` | Published branches & treatments render from master data | BLANK |
| J11-2 | Inspect unpublished-price treatment & promotional copy guard | Shows `"Harga dijelaskan saat konsultasi"`; zero advertised discounts | BLANK |
| J11-3 | Verify doctor without consent hidden; withdraw consent on consented doctor | Doctor absent immediately on next request; photo cleared | BLANK |
| J11-4 | Click `Buat Janji` from treatment page; inspect WhatsApp link | Treatment & branch prefilled; WA link carries neutral ref only | BLANK |
| J11-5 | Inspect DevTools Network on `/<slug>/perawatan/*` & `/<slug>/booking` with marketing consent | Zero pixel/analytics/replay requests on health-intent & booking routes | BLANK |
| J11-6 | Open unpublished or suspended tenant slug | Returns neutral 404/closed notice with zero tenant data | BLANK |

**Owner Sign-off:** BLANK (not claimed before staging execution).
