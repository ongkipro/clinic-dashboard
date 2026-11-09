// Layar Antrean (19:56, NAV-8; T-048): a paired display device, not a staff session. The token in the
// path is the device's credential (only its hash is stored); the feed carries numbers and room names only,
// never a patient name (fixed rule), for the display's own branch. Refreshes every 5 seconds; no promo
// slideshow. A revoked or unknown token shows one neutral message.
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { appPool } from "../../../modules/org/context/store";
import { displayFeed } from "../../../modules/visits/queue/queue";
import { Refresh } from "./refresh";

export const metadata: Metadata = { title: "Layar Antrean", robots: { index: false, follow: false }, referrer: "no-referrer" };

async function Screen({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const feed = await displayFeed(await appPool(), token);
  if (!feed) {
    return <main className="grid min-h-dvh place-items-center bg-[var(--bg-grouped)] p-8 text-center"><p className="m-0 text-[1.5rem]">Layar ini belum dipasangkan atau sudah dicabut.</p></main>;
  }
  const portrait = feed.orientation === "portrait";
  return (
    <main aria-label={`Antrean ${feed.branch}`} className={`grid min-h-dvh gap-6 bg-[var(--bg-grouped)] p-8 ${portrait ? "grid-rows-[auto_1fr_auto]" : "grid-cols-[2fr_1fr] grid-rows-[auto_1fr]"}`}>
      <h1 className={`m-0 text-[2rem] font-bold ${portrait ? "" : "col-span-2"}`}>{feed.branch}</h1>
      <section aria-labelledby="dipanggil" className="grid content-start gap-4">
        <h2 id="dipanggil" className="m-0 text-[1.5rem] text-[var(--label-2)]">Dipanggil</h2>
        {feed.current.length === 0 ? <p className="m-0 text-[1.5rem]">Belum ada panggilan.</p> : (
          <ol className="m-0 grid list-none gap-3 p-0" aria-live="polite">
            {feed.current.map((c, i) => (
              <li key={`${c.number}-${i}`} className={`flex flex-wrap items-baseline justify-between gap-4 rounded-[var(--radius-group)] bg-[var(--surface)] p-6 ${i === 0 ? "text-[var(--tint)]" : ""}`}>
                <span className={`font-bold tabular-nums ${i === 0 ? "text-[5rem]" : "text-[2.5rem]"}`}>{c.number}</span>
                <span className={i === 0 ? "text-[2.5rem]" : "text-[1.5rem]"}>{c.room}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-labelledby="berikutnya" className="grid content-start gap-4">
        <h2 id="berikutnya" className="m-0 text-[1.5rem] text-[var(--label-2)]">Berikutnya</h2>
        {feed.next.length === 0 ? <p className="m-0 text-[1.5rem]">Tidak ada yang menunggu.</p> : (
          <ol className="m-0 grid list-none gap-3 p-0">{feed.next.map((n) => <li key={n} className="rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[2rem] font-semibold tabular-nums">{n}</li>)}</ol>
        )}
      </section>
      <Refresh voice={feed.voice} current={feed.current[0] ? `${feed.current[0].number} ${feed.current[0].room}` : ""} />
    </main>
  );
}

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-[var(--bg-grouped)]"><p className="m-0 text-[1.5rem]">Memuat antrean</p></main>}>
      <Screen params={params} />
    </Suspense>
  );
}
