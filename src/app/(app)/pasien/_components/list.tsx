"use client";
// Daftar Pasien (PR-76, 19:75, T-041): search box and filters posted to the server (the query never goes
// into a URL), results with masked phone, MRN, registered branch and visit status (no clinical content),
// "Muat lagi" for the next page, and the staff member's own saved segments (filters only). Every write form
// posts its rendered context (HYG-009 B2-1) and a per-mount idempotency key.
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import { EmptyState } from "../../../../components/ui/states";
import type { RenderedContext } from "../../../../modules/org/context/context";
import type { Filters, Segment } from "../../../../modules/patients/search/search";
import { deleteSegmentAction, saveSegmentAction, searchAction, type SearchState, type SegmentState } from "./actions";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const date = (d: Date) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(d));
const LAST: Record<string, string> = { "30d": "Datang 30 hari terakhir", "90d": "Datang 90 hari terakhir", never: "Belum pernah berkunjung" };

function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function FilterFields({ branches, f }: { branches: { id: string; name: string }[]; f: Filters }) {
  const b = useId();
  const l = useId();
  return (
    <div className="grid min-w-0 gap-3 @[44rem]:grid-cols-[1fr_1fr_auto] @[44rem]:items-end">
      <div className="grid min-w-0 gap-1">
        <label htmlFor={b} className="font-semibold">Cabang pendaftaran</label>
        <select id={b} name="branch_id" className={input} defaultValue={f.branch_id ?? ""}>
          <option value="">Semua cabang</option>
          {branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <div className="grid min-w-0 gap-1">
        <label htmlFor={l} className="font-semibold">Kunjungan terakhir</label>
        <select id={l} name="last_visit" className={input} defaultValue={f.last_visit ?? ""}>
          <option value="">Kapan saja</option>
          {Object.entries(LAST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <label className="flex min-h-[var(--target)] items-center gap-2"><input type="checkbox" name="visiting_now" defaultChecked={Boolean(f.visiting_now)} /> Sedang berkunjung</label>
    </div>
  );
}

export function PatientList({ ctx, branches, segments }: { ctx: RenderedContext; branches: { id: string; name: string }[]; segments: Segment[] }) {
  const [s, act, pending] = useActionState<SearchState, FormData>(searchAction, {});
  // A segment or "Hapus Filter" sets the form's values until the next answer: it overrides the last
  // answer's filters and text (review r1: they were ignored once any search had run). The form remounts
  // so its uncontrolled fields take the new defaults.
  const [override, setOverride] = useState<{ base: number; seq: number; filters: Filters } | null>(null);
  const q = useId();
  const n = s.n ?? 0;
  const active = override && override.base === n ? override : null;
  const filters = active ? active.filters : (s.filters ?? {});
  const query = active ? "" : (s.q ?? "");
  const searched = !active && Boolean(s.searched);
  const shown = active ? [] : (s.rows ?? []);
  const anyFilter = Object.keys(filters).length > 0;
  const apply = (f: Filters) => setOverride((p) => ({ base: n, seq: (p?.seq ?? 0) + 1, filters: f }));
  return (
    <div className="@container grid min-w-0 gap-4">
      <form action={act} aria-label="Cari pasien" className="grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4" key={`f-${n}-${active?.seq ?? 0}`}>
        <ContextFields ctx={ctx} />
        <div className="grid min-w-0 gap-1">
          <label htmlFor={q} className="font-semibold">Cari nama, No. RM atau nomor HP</label>
          <div className="flex min-w-0 flex-wrap gap-2">
            <input id={q} name="q" className={`${input} flex-1 basis-56`} defaultValue={query} autoComplete="off" />
            <Button type="submit" aria-disabled={pending}>Cari</Button>
          </div>
        </div>
        <FilterFields branches={branches} f={filters} />
        {!active && s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      </form>

      {segments.length > 0 && (
        <section aria-labelledby="segmen" className="grid min-w-0 gap-2">
          <h2 id="segmen" className="m-0 text-[1.18rem] font-semibold">Segmen tersimpan</h2>
          <ul className="m-0 flex min-w-0 list-none flex-wrap gap-2 p-0">
            {segments.map((g) => (
              <li key={g.id} className="flex min-w-0 items-center gap-1 rounded-full bg-[var(--surface)] pl-2">
                <Button type="button" variant="plain" onClick={() => apply(g.filters)}>{g.name}</Button>
                <DeleteSegment ctx={ctx} id={g.id} name={g.name} />
              </li>
            ))}
          </ul>
          {active && Object.keys(active.filters).length > 0 && <p className={muted}>Filter segmen dipasang. Tekan Cari untuk menampilkan pasien.</p>}
        </section>
      )}

      {searched && shown.length === 0 && (
        anyFilter || query
          ? <div className="grid min-w-0 gap-2"><EmptyState message="Tidak ada pasien untuk pencarian atau filter ini." />
              <div><Button type="button" variant="plain" onClick={() => apply({})}>Hapus Filter</Button></div></div>
          : <EmptyState message="Belum ada pasien." />
      )}
      {shown.length > 0 && (
        <section aria-labelledby="hasil" className="grid min-w-0 gap-2">
          <h2 id="hasil" className="m-0 text-[1.18rem] font-semibold">Hasil ({shown.length}{s.more ? "+" : ""})</h2>
          <ul className="m-0 grid min-w-0 list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
            {shown.map((r) => (
              <li key={r.id} className="border-b border-[var(--separator)] last:border-b-0 [border-bottom-width:0.5px]">
                <Link href={`/pasien/${r.id}`} className="grid min-h-[var(--target)] min-w-0 gap-0.5 px-4 py-3 text-[var(--label)] no-underline hover:bg-[var(--accent)]">
                  <span className="font-semibold [overflow-wrap:anywhere]">{r.fullName}</span>
                  <span className={`${muted} [overflow-wrap:anywhere]`}>
                    {r.mrn} · lahir {r.birthYear}{r.maskedPhone ? ` · ${r.maskedPhone}` : ""} · {r.registeredBranch}
                  </span>
                  <span className={`${muted} [overflow-wrap:anywhere]`}>
                    {r.openVisitBranch ? `Sedang berkunjung · ${r.openVisitBranch}` : r.lastVisitAt ? `Terakhir datang ${date(r.lastVisitAt)}` : "Belum pernah berkunjung"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {s.more && (
            <form action={act} aria-label="Muat lagi">
              <ContextFields ctx={ctx} />
              <input type="hidden" name="q" value={query} />
              {filters.branch_id && <input type="hidden" name="branch_id" value={filters.branch_id} />}
              {filters.last_visit && <input type="hidden" name="last_visit" value={filters.last_visit} />}
              {filters.visiting_now && <input type="hidden" name="visiting_now" value="on" />}
              <input type="hidden" name="after" value={shown[shown.length - 1].id} />
              <Button type="submit" variant="secondary" aria-disabled={pending}>Muat lagi</Button>
            </form>
          )}
        </section>
      )}
      {anyFilter && searched && <SaveSegment ctx={ctx} filters={filters} />}
    </div>
  );
}

function SaveSegment({ ctx, filters }: { ctx: RenderedContext; filters: Filters }) {
  const [s, act, pending] = useActionState<SegmentState, FormData>(saveSegmentAction, {});
  const id = useId();
  return (
    <form action={act} key={`s${s.n ?? 0}`} aria-label="Simpan segmen" className="flex min-w-0 flex-wrap items-end gap-2">
      <ContextFields ctx={ctx} /><Key />
      {filters.branch_id && <input type="hidden" name="branch_id" value={filters.branch_id} />}
      {filters.last_visit && <input type="hidden" name="last_visit" value={filters.last_visit} />}
      {filters.visiting_now && <input type="hidden" name="visiting_now" value="on" />}
      <div className="grid min-w-0 flex-1 basis-56 gap-1">
        <label htmlFor={id} className="font-semibold">Simpan filter ini sebagai segmen</label>
        <input id={id} name="name" className={input} placeholder="Nama segmen" />
      </div>
      <Button type="submit" variant="secondary" aria-disabled={pending}>Simpan Segmen</Button>
      {s.error && <p role="alert" className="m-0 w-full text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 w-full text-[var(--success)]">{s.ok}</p>}
    </form>
  );
}

function DeleteSegment({ ctx, id, name }: { ctx: RenderedContext; id: string; name: string }) {
  const [s, act, pending] = useActionState<SegmentState, FormData>(deleteSegmentAction, {});
  return (
    <form action={act} key={`d${s.n ?? 0}`} aria-label={`Hapus segmen ${name}`}>
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="id" value={id} />
      <Button type="submit" variant="plain" aria-disabled={pending} aria-label={`Hapus segmen ${name}`}>×</Button>
      {s.error && <span role="alert" className="text-[var(--danger)]">{s.error}</span>}
    </form>
  );
}
