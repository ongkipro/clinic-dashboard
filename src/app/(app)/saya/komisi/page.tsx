// Komisi Saya (Saya › Komisi Saya, 19:229, UX-16; T-087): the acting staff member's own commission of a month — each entitlement and
// adjustment with its type, item, invoice number and branch — and their batch lines (paid, carried forward). Only their own rows (the
// database: commission_mine; DEC-099). No patient data.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { type Mine, myCommission } from "../../../../modules/commission/commission";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { thisMonth } from "../../komisi/data";
import { BATCH, CAUSE, day, month, rp, TYPE, value } from "../../komisi/labels";

export const metadata: Metadata = { title: "Komisi Saya — Clinic Dashboard" };
const TITLE = "Komisi Saya";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const panel = "grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const shift = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const now = thisMonth();
  const m = typeof sp.bulan === "string" && MONTH.test(sp.bulan) && sp.bulan <= now ? sp.bulan : now;
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "komisi" }} />;
  let d: Mine;
  try {
    d = await withTenantContext(await appPool(), rc.active.context, (db) => myCommission(db, m));
  } catch (e) {
    if (e instanceof CommandError) return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "komisi" }} />;
    throw e;
  }
  const earned = d.rows.filter((r) => r.kind === "entitlement").reduce((s, r) => s + Number(r.amount), 0);
  const adjusted = d.rows.filter((r) => r.kind === "adjustment").reduce((s, r) => s + Number(r.amount), 0);
  const chips = [{ label: "Bulan lalu", href: `/saya/komisi?bulan=${shift(m, -1)}`, active: false }, { label: "Bulan ini", href: "/saya/komisi", active: m === now },
    ...(m < now ? [{ label: "Bulan berikutnya", href: `/saya/komisi?bulan=${shift(m, 1)}`, active: false }] : [])];
  return (
    <ListPage as="section" title={TITLE} filters={chips} state={{ kind: "rows" }}>
      <section aria-label={`Komisi ${month(m)}`} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
        <p className="m-0 text-[0.94rem] text-[var(--label-2)]">{`Komisi ${month(m)}`}</p>
        <p className="m-0 text-[1.5rem] font-semibold tabular-nums">{rp(earned + adjusted)}</p>
        <p className={`${muted} tabular-nums`}>{`Komisi ${rp(earned)} · Penyesuaian ${rp(adjusted)}`}</p>
        <p className={muted}>Komisi tercatat saat pembayaran diterima dan tindakan selesai; dibayar lewat batch bulanan.</p>
      </section>
      {d.rows.length > 0 ? (
        <ul aria-label="Rincian komisi" className="m-0 grid min-w-0 list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
          {d.rows.map((r) => (
            <li key={r.id} className="grid min-w-0 gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{`${TYPE[r.type]} · ${r.item ?? "Item"}`}</span>
                <span className={`tabular-nums ${Number(r.amount) < 0 ? "text-[var(--danger)]" : ""}`}>{rp(Number(r.amount))}</span>
              </div>
              <span className={muted}>
                {[day(r.at), r.invoice, r.branch, r.kind === "adjustment" ? `Penyesuaian: ${CAUSE[r.cause ?? ""] ?? r.cause}${r.after_payout ? " (setelah dibayar)" : ""}` : r.rule && `Aturan ${value(r.rule)}`]
                  .filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className={panel} role="status"><p className="m-0 text-[var(--label-2)]">{`Belum ada komisi di ${month(m)}.`}</p></div>
      )}
      {d.lines.length > 0 && (
        <section aria-labelledby="batch-saya" className="grid min-w-0 gap-2">
          <h2 id="batch-saya" className="m-0 text-[1.18rem] font-semibold">Pembayaran</h2>
          <ul className="m-0 grid min-w-0 list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
            {d.lines.map((l) => (
              <li key={l.period} className="grid min-w-0 gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{`${month(l.period)} · ${rp(Number(l.net_payable))}`}</span>
                  <StatusBadge tone={BATCH[l.state][1]}>{BATCH[l.state][0]}</StatusBadge>
                </div>
                {Number(l.carry_forward_out) > 0 && <span className={muted}>{`Potongan ${rp(Number(l.carry_forward_out))} dibawa ke bulan berikutnya.`}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {d.receivables.some((r) => r.state === "open") && <p className={muted}>Ada sisa potongan komisi yang menunggu keputusan Owner.</p>}
    </ListPage>
  );
}

export default function KomisiSayaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
