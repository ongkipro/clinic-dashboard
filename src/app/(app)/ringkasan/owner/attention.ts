// Ringkasan Owner (UX-20 §1), T-109: "Perlu ditangani" — the six required items, each answered by an existing, AUTHORIZED reader for the owner, or shown as
// `unavailable` with the exact reason. A missing answer is never an empty queue (Sol decision 2), and a count the reader may have truncated is never shown as
// the true count. The six are matched below; the gaps are the System Map delta's "Perlu ditangani" list.
//
//   persetujuan   approvals `listInbox('owner')`  — measured (≥ the cap when `more`: shown as unavailable, not as 200).
//   lead_sla      `leadList('open','all')` → `sla_overdue` — measured; the reader lists ≤ 200 leads, so a full page is unavailable.
//   satusehat     `monitor(branch)` per branch, links `failed` / `exception` (the T-107 Klinis home's own "rejected" definition) — measured per tenant.
//   stok_klinis   `dashboard_kpi('k18').by_dim.below_min` — measured: items below their branch minimum (the label says what is counted).
//   kepatuhan     `compliance_register()` — only the status `expired` is measured (label: "sudah kedaluwarsa"); the register has no "expiring soon" window and the
//                 spec defines none, so evidence "hampir habis" is NOT counted and no threshold is invented. Reported as a gap against UX-20 §1.
//   belum_bayar   `visits_today(branch)` per branch (the Hari Ini board's own reader): OPEN visits that are `unpaid()` (payment step in progress or blocked — the predicate the visit-close guard
//                 refuses on; DEC-057 "Payment until the cashier") and were checked in BEFORE that branch's own today (the reader's `today`, in the branch timezone) — measured per tenant: a branch that cannot be read
//                 makes the item unavailable (never a partial sum). A visit with no bill yet ("belum ditagih") is NOT counted: the board reads the payment column only. No link: /hari-ini
//                 shows one branch's board and is not in the owner's menu.
import type pg from "pg";
import { guarded } from "./guard";
import type { Attention, AttentionKey } from "./model";
import { INBOX_LIMIT, listInbox } from "../../../../modules/approvals/inbox";
import { register } from "../../../../modules/compliance/compliance";
import { leadList } from "../../../../modules/crm/leads/leads";
import { monitor } from "../../../../modules/integrations/satusehat/satusehat";
import type { KpiResult } from "../../../../modules/reporting/dashboards/dashboards";
import { localDate } from "../../../../modules/tax/policy";
import { today as boardOf, unpaid } from "../../../../modules/visits/visits";
import type { Role } from "../../../../auth/policy";

// Only destinations that (1) exist on main, (2) are in the OWNER's navigation (nav.ts) and (3) list the same population as the count. /satusehat and /stok/item show ONE
// branch while these counts are clinic-wide, and /lead and /stok/item are not in the owner's menu (nav "CS BC MK" / "PH PU AP": the page would admit the owner but the
// menu never offers it) — so those carry no link (outstanding drill-down contract). /persetujuan and /kepatuhan?status=expired list exactly what is counted.
const LINK: Partial<Record<AttentionKey, string>> = { persetujuan: "/persetujuan", kepatuhan: "/kepatuhan?status=expired" };
const LEAD_CAP = 200; // lead_list LIMIT 200 (0107): a full page may hide more
const none = (reason: string, key: AttentionKey): Attention => ({ key, state: "unavailable", reason });
const count = (key: AttentionKey, n: number): Attention => (LINK[key] ? { key, count: n, href: LINK[key] } : { key, count: n });

const UNPAID_DOWN = "Papan kunjungan belum dapat dibaca untuk semua cabang";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Kunjungan belum bayar sebelum hari ini: one `visits_today` call per branch the context lists, each under its own savepoint. The date of a check-in is taken in THAT branch's timezone and
// compared with the reader's own `today` (also the branch's): not the server clock, and not WIB for every branch. The filter runs inside the guard, so a malformed answer (a `today` that is
// not a date, an unknown zone) is an unavailable item — never a number and never a failed screen. No branch to read is unavailable too, as for SATUSEHAT.
// lazy: `visits_today` has no LIMIT and answers every OPEN visit of the branch with the patient's name and MRN (the Hari Ini board reads the same payload); only a count leaves this function; no row or patient field is logged (on an unexpected
// failure the guard logs the reader's name and the error class, nothing else). A branch with a very large backlog of never-closed visits makes this read heavier. Upgrade path: a count-only definer — a migration, so not in this slice.
async function unpaidBeforeToday(db: pg.ClientBase, branchIds: string[]): Promise<Attention> {
  if (branchIds.length === 0) return none(UNPAID_DOWN, "belum_bayar");
  let n = 0;
  for (const id of branchIds) {
    const c = await guarded(db, "visits", async () => {
      const t = await boardOf(db, id);
      if (!DAY.test(t.today)) throw new Error("visits_today: malformed today");
      return t.visits.filter((v) => unpaid(v) && localDate(v.checkedInAt, t.timezone) < t.today).length;
    });
    if (c === null) return none(UNPAID_DOWN, "belum_bayar"); // no partial sum
    n += c;
  }
  return count("belum_bayar", n);
}

// `k18` is the summary's own K18 answer (already read for the stock-risk card): not read twice.
export async function loadAttention(db: pg.ClientBase, role: Role, branchIds: string[], k18: KpiResult | null): Promise<Attention[]> {
  const out: Attention[] = [];

  const inbox = await guarded(db, "approvals", () => listInbox(db, role));
  out.push(inbox === null ? none("Antrean persetujuan belum dapat dibaca", "persetujuan")
    : inbox.more ? none(`Lebih dari ${INBOX_LIMIT} persetujuan menunggu; jumlah pastinya belum tersedia`, "persetujuan") : count("persetujuan", inbox.rows.length));

  out.push(await unpaidBeforeToday(db, branchIds));

  out.push(k18 === null ? none("Risiko stok belum dapat dibaca", "stok_klinis") : count("stok_klinis", k18.by_dim.below_min ?? 0));

  const leads = await guarded(db, "leads", () => leadList(db, "open", "all"));
  out.push(leads === null ? none("Daftar lead belum dapat dibaca", "lead_sla")
    : leads.leads.length >= LEAD_CAP ? none(`Daftar lead penuh (${LEAD_CAP}); jumlah yang melewati batas respons belum pasti`, "lead_sla")
    : count("lead_sla", leads.leads.filter((l) => l.sla_overdue).length));

  // one monitor call per branch; if any branch cannot be read the tenant total is not known
  let failed = 0;
  let unreadable = false;
  for (const b of branchIds) {
    const m = await guarded(db, "satusehat", () => monitor(db, b));
    if (m === null) { unreadable = true; continue; }
    failed += Object.entries(m.links).filter(([s]) => /^(failed|exception)(:|$)/.test(s)).reduce((a, [, n]) => a + n, 0);
  }
  out.push(unreadable || branchIds.length === 0 ? none("Status kiriman SATUSEHAT belum dapat dibaca untuk semua cabang", "satusehat") : count("satusehat", failed));

  const reg = await guarded(db, "compliance", () => register(db));
  out.push(reg === null ? none("Daftar kepatuhan belum dapat dibaca", "kepatuhan")
    : count("kepatuhan", reg.filter((r) => r.status === "expired").length));

  return out;
}
