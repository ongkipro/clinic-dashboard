# Visual references — Zendenta (Dribbble concept shots)

Source: 13 Dribbble images supplied by the user on 2026-10-31 (`ref-01`–`ref-13`). All show "Zendenta", a dental-clinic admin concept. Concept shots, not a shipped product: use as style and pattern reference only; do not copy branding, illustrations, or exact layouts.

## Patterns worth adopting

| Ref | Pattern | Use in our screens |
|---|---|---|
| 01, 11 | Day calendar with practitioner columns, status chips, break time, "not available" hatching, current-time line, and a "waiting payment" strip | Schedule/queue; unpaid additional treatment visible in the day view |
| 02 | Patient table: last visit, last treatment, active/inactive tabs | Patient list |
| 06 | Invoice list with expandable sub-bills (booking fee separate from treatment) and Partially paid / Unpaid / Fully paid | Cashier history: booking DP, installments, outstanding |
| 07 | Bill drawer: treatment / materials used / medicine grouped, split payment method picker, quick cash amounts | Cashier payment |
| 08 | Stock summary bar (in stock / low / out) above the inventory table | Pharmacy stock minimum reminder |
| 09 | Purchase orders with received progress (2/4) and partial receipt | Supplier purchase and goods receipt |
| 10, 11 | Patient profile with a visit/treatment timeline and per-visit notes | Doctor history panel |
| 12 | Per-item Done / Not done with required reason | Interrupted or partial treatment |
| 13 | Materials used with quantity steppers and stock remaining | Treatment completion: confirm exceptions only |

## Do not adopt

- Dental-specific content (tooth numbers, tooth chart).
- "Profit this month" on the sales page: profit cannot be read from cash; package and balance liabilities must stay separate.
- Accounts page with fund cards: full accounting is outside the proposed MVP.
- Star ratings and review counts on the treatment master.
- Customer-facing playful elements (decorative blobs in 10–11).

## Color reference — numaskin.id (requested by the user, 2026-10-31)

Extracted from the live site's stylesheet (`app-woewnt_g.css`, brand tokens). Contrast measured against white (WCAG 2.x ratio):

| Token on site | Hex | Role in prototype | Contrast on white |
|---|---|---|---|
| brand-marine | #002B49 | headings, titles, key figures | 14.57 |
| gradient teal | #0B6E7D | primary button, links, active menu (white text) | 5.93 — passes AA text |
| brand-cyan | #269BA8 | accents, icons, focus, progress only | 3.31 — fails AA body text |
| brand-aqua | #38B6CD | optional chart accent | (lower) |
| surface-foam | #F4F9FA | app background | — |
| surface-mist | #EBF5F8 | selected row / active menu bg | — |
| border-hairline | #E2EDF0 | borders | — |
| brand-coral | #E05368 | unpaid/error tint with dark text | 3.75 — not for small text |
| brand-gold | #C5A869 | tiny decorative accent only | 2.29 — never text |
| font | Inter (site also uses DM Serif Display for marketing headings; not used in the admin) | | |

Colors only; numaskin.id layout and content are not used. Zendenta shots remain the layout/pattern reference.
