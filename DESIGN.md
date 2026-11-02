# DESIGN.md — Clinic Dashboard

<!-- dotuiux format. Contract and rules: 10-DESIGN-SYSTEM-WHITELABEL.md (UI-*). Screens: 17-UX-FLOWS-SCREEN-CONTRACTS.md (UX-*).
Direction decided 2026-11-02 (DECISION-REGISTER D-14 full Apple style, D-15 light only, D-16 tenant accent).
Source: Apple Human Interface Guidelines (rules captured in this kit; original source github.com/dickwu/apple-design-skill @ff4ebdd, optional) (2026-10-28). Rationale and screen sketches: UX-CONCEPT-APPLE-STYLE.md.
Supersedes the "Klinik Lapang" desktop-first direction. Status: In Review. Owner: Design owner. Promote to repository root when development is authorized. -->

## Direction

- Feel: **native, calm, exact**. Each role's screens behave like a well-made iPhone/iPad app: bottom tab bar, large titles, inset grouped lists, sheets for short tasks, one prominent action per view.
- Built mobile-first and tablet-first (staff phones, clinic-room iPads); the same layout grows to desktop with a sidebar. Layout follows available width (size classes), never the device type.
- Signature: **Jalur Kunjungan** — the visit track capsule on every patient screen, segments filling in per independent visit state, with the one blocker written beneath it. Everything else stays quiet.
- Appearance: **light only** in Release 1.
- Photo style: tenant's real clinic photos on the public site and booking only; clinical photos never public without publication consent.
- Public site (UI-16): same tokens and system font; one template per tenant; clinical clarity — real place photos, facts per treatment (who performs it, duration, downtime, price basis), no carousel, no pastel blobs, no model-face hero by default; compact sticky bar "Buat Janji" + "WhatsApp" with text labels.
- Vendor console (UI-17): desktop-first, sidebar, data tables; support-session banner in `--warning`.
- Motion profile: **subtle** — sheet and navigation transitions only; nothing animates on dashboards.
- Won't do: dark mode (Release 1); glass or blur on content, cards, lists or the visit track; more than one tinted button per view; colour-only status; hidden or disabled tabs; Apple fonts or SF Symbols bundled into the web app; WhatsApp-green floating buttons.

## Tokens

### Colour

Light appearance only. Contrast values are WCAG 2.x, computed from hex.

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--bg` | `#FFFFFF` | Plain screens | — |
| `--bg-grouped` | `#F2F2F7` | Inset grouped lists, forms, settings | — |
| `--surface` | `#FFFFFF` | Cells, cards, sheets on grouped background | — |
| `--surface-2` | `#E9E9EE` | Segmented control track, nested fills | — |
| `--label` | `#000000` | Primary text | 21.0 white · 18.9 grouped |
| `--label-2` | `#636366` | Secondary text, metadata | 5.99 white · 5.37 grouped · 4.95 surface-2 · 5.18 tint-soft |
| `--label-3` | `#8A8A8E` | Disabled only — never information; placeholders use `--label-2` and never replace a visible label | 3.44 white |
| `--separator` | `#C6C6C8` | Hairlines between cells (decorative) | 1.71 |
| `--control-border` | `#7C7C80` | Text field, checkbox, radio boundary | 4.16 white · 3.73 grouped (≥ 3:1) |
| `--tint` | `#0A6E86` (default; tenant-replaceable) | Selected tab, links, primary button fill, focus ring | 5.85 white · 5.25 grouped · ≥ 4.91 on bar glass over any content (worst case black) |
| `--on-tint` | `#FFFFFF` | Label on tinted button | 5.85 |
| `--tint-soft` | `#E2EEF0` (derived: tint at 12% over white, sRGB blend) | Selected row, chips | tint on soft 4.94 · label-2 on soft 5.05 |
| `--danger` / `--danger-soft` | `#C4281C` / `#FDECEA` | Allergy, blocker, destructive | 5.73 white · 5.13 grouped · 5.01 soft |
| `--warning` / `--warning-soft` | `#A14F00` / `#FFF1DF` | Pending, near expiry, unpaid | 5.78 · 5.18 · 5.20 |
| `--success` / `--success-soft` | `#1E7A34` / `#E7F5EA` | Paid, signed, done | 5.40 · 4.84 · 4.80 |
| `--locked` / `--locked-soft` | `#4B3FB5` / `#EEEBFB` | Signed record, locked period | 6.69 soft |
| `--neutral` / `--neutral-soft` | `#3A3A3C` / `#E9E9EE` | Draft, scheduled | 9.38 |
| `--badge` | `#D70015` with white text | Tab badge counts (critical only) | 5.38 |
| `--chart-1…4` | `#0072B2` `#D55E00` `#009E73` `#B5568C` | Chart series on `--surface` only | 5.19 · 3.87 · 3.42 · 4.49 |
| Face map | complaint `#B04F00` dashed · finding `#0B4A5C` · action = `--tint` numbered | Layers | 5.30 · 9.78 · 5.85 |

Tenant accent (D-16): the tenant enters one hex. The system computes `--tint-soft` (accent at 12% over white) and accepts the accent only if: accent on white ≥ 4.5:1 (equivalently white on accent), accent on `--bg-grouped` ≥ 4.5:1, accent on its soft ≥ 4.5:1, accent on bar glass over black (`#EBEBEB`) ≥ 4.5:1. Otherwise the screen shows the failing ratio and suggests the nearest darker shade.

Increased contrast (`prefers-contrast: more`): `--label-2` → `#3A3A3C`, separators → `--control-border`, bar glass → opaque `--bg`.

### Type

- Family: device system font only — `-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. No font files bundled.
- Numbers: `font-variant-numeric: tabular-nums` for money, doses, times, counts.
- Scale = iOS Dynamic Type "Large (default)"; all sizes in rem relative to a 17 px Body root (Body = 1rem). Browser text size scales everything; iOS/iPadOS Dynamic Type reaches web content only through the system font keyword:

```css
html { font-size: 106.25%; } /* 17 px */
@supports (font: -apple-system-body) { html { font: -apple-system-body; font-family: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; } }
```

- Layouts must survive 200% text; checked on iPad with the largest non-accessibility Dynamic Type size.
- `<meta name="color-scheme" content="only light">` and `:root { color-scheme: only light; }` stop forced dark mode; manifest `theme_color` and `background_color` = `#FFFFFF`.

| Style | px / leading | Weight | Use |
|---|---|---|---|
| Large Title | 34 / 41 | 700 | Tab root titles; collapses to 17 semibold inline title on scroll |
| Title 1 | 28 / 34 | 700 | Hero amount (owner, cashier remaining) |
| Title 2 | 22 / 28 | 700 | Sheet titles |
| Title 3 | 20 / 25 | 600 | Section titles in regular width |
| Headline | 17 / 22 | 600 | Emphasized cell text |
| Body | 17 / 22 | 400 | Default text and all form inputs |
| Callout | 16 / 21 | 400 | Field descriptions |
| Subhead | 15 / 20 | 400 | Cell secondary text |
| Footnote | 13 / 18 | 400 | Section headers/footers (section header uppercase not used), timestamps |
| Caption 1 | 12 / 16 | 400 | Chart labels, badge text |
| Caption 2 | 11 / 13 | 600 | Tab bar labels only (minimum) |

### Radius

Inset groups and cards 12 px · sheets 16 px top corners · buttons: capsule (primary and secondary) · text fields 10 px · badges capsule.

### Spacing

Base 4 px. Scale 4, 8, 12, 16, 20, 24, 32, 44. Screen margins 16 px (compact) / 20 px (regular). List cell min height 44 px, 11 px vertical padding; clinical-room cells 52 px. Touch targets ≥ 44 × 44 px with ≥ 8 px gaps; primary buttons 50 px tall.

### Motion

Sheets and push navigation 300 ms `cubic-bezier(0.32, 0.72, 0, 1)`; press feedback 120 ms; cross-fade 200 ms. `prefers-reduced-motion: reduce` → cross-fades only. No looping animation.

### Materials

Glass only on the floating functional layer (tab bar, scrolled top bar, sheet header area, floating action capsule):

```css
.bar-glass { background: rgb(255 255 255 / 0.92); -webkit-backdrop-filter: blur(10px) saturate(1.4); backdrop-filter: blur(10px) saturate(1.4); border-top: 0.5px solid rgb(0 0 0 / 0.12); }
@media (prefers-contrast: more), (prefers-reduced-transparency: reduce) { .bar-glass { background: #FFFFFF; backdrop-filter: none; } }
html.reduce-transparency .bar-glass { background: #FFFFFF; backdrop-filter: none; }
```

Blur is capped at 10 px (house gate `dotuiux` D4: > 10 px fails); the 92% fill keeps tab labels (tint and `--label-2`, 11 px) ≥ 4.5:1 even over black scrolled content (4.91 / 5.02); fill must never drop below 0.885. Unselected tab labels use `--label-2`. `prefers-reduced-transparency` is not supported by Safari, so Saya › Tampilan offers "Kurangi transparansi" (sets `reduce-transparency` on `<html>`).

## Layout

- Size classes by available width: **compact < 700 px**, **regular ≥ 700 px**, **regular-wide ≥ 1180 px**.
- Compact: bottom tab bar (≤ 5 tabs, glass, labels ≤ 2 words and ≤ 13 characters, filled icon when selected, safe-area padding), push navigation, sheets with grabber and medium/large detents.
- Regular: same tabs as a leading sidebar (max two levels) + content; list/detail split view.
- Regular-wide: optional third pane (history, inspector) that collapses into a sheet below 1180 px without losing edits.
- Safe areas: `env(safe-area-inset-*)` on bars and sheets; sticky action bars stay above the on-screen keyboard (`visualViewport`).
- One prominent (tinted) action per view, placed bottom-centre in compact, top-trailing toolbar in regular. Lists of approvals or tasks use plain buttons or swipe actions per row; the prominent button appears only in the detail.
- Clinical-room screens (Ruang Tindakan): grouped cells get a 1 px `--separator` outline in addition to the background step, because white on `#F2F2F7` (1.12:1) disappears under glare.

## Icons

Lucide (via shadcn), 1.75 px stroke beside 17 px text, filled-style variant for the selected tab; every icon-only control has an accessible name.

## Allow

allow: sidebar-group — regular-width sidebar mirrors the role's tabs plus Saya sub-sections; more than one group is intended.
allow: blur — the 10 px backdrop blur is limited to the tab bar and scrolled top bar (Apple bar material), never on content.
