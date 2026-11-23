"use client";
// Keluarga / Wali list (HYG-NAV-2): the filter runs in the browser over the households already rendered, so a patient's name never goes
// into a URL or a request (as Daftar Pasien posts its query, T-041).
import Link from "next/link";
import { useId, useState } from "react";
import { filterHouseholds, type Household } from "./model";

const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
export const RELATION: Record<string, string> = { ayah: "Ayah", ibu: "Ibu", wali: "Wali", lainnya: "Lainnya" };

export function Households({ all }: { all: Household[] }) {
  const [q, setQ] = useState("");
  const id = useId();
  const shown = filterHouseholds(all, q);
  return (
    <>
      <div role="search" className="flex min-w-0 flex-wrap gap-2">
        <label htmlFor={id} className="sr-only">Saring nama wali, nama pasien atau No. RM</label>
        <input id={id} value={q} onChange={(e) => setQ(e.target.value.slice(0, 60))} className={`${input} flex-[1_1_14rem]`}
          placeholder="Saring nama wali, nama pasien atau No. RM" autoComplete="off" />
      </div>
      {shown.length === 0 ? (
        <div role="status" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0 text-[var(--label-2)]">Tidak ada wali untuk filter ini.</p>
          <button type="button" onClick={() => setQ("")} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Hapus Filter</button>
        </div>
      ) : (
        <ul aria-label="Wali dan pasien" className="m-0 grid min-w-0 list-none gap-3 p-0 min-[1180px]:grid-cols-2">
          {shown.map((h) => (
            <li key={h.key} className="grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
              <div className="grid gap-0.5">
                <span className="font-semibold [overflow-wrap:anywhere]">{h.guardianName}</span>
                <span className={muted}>{h.phone ?? "Tanpa nomor HP"}{h.guardianPatientId ? " · juga terdaftar sebagai pasien" : ""}</span>
                {h.guardianPatientId && <Link href={`/pasien/${h.guardianPatientId}`} className="inline-flex min-h-[var(--target)] items-center self-start text-[var(--tint)]">Profil wali</Link>}
              </div>
              <ul aria-label={`Pasien dengan wali ${h.guardianName}`} className="m-0 grid list-none gap-1 p-0">
                {h.children.map((c) => (
                  <li key={c.patientId}>
                    <Link href={`/pasien/${c.patientId}`} className="grid min-h-[var(--target)] min-w-0 gap-0.5 rounded-[var(--radius-field)] px-3 py-2 text-[var(--label)] no-underline hover:bg-[var(--accent)]">
                      <span className="font-semibold [overflow-wrap:anywhere]">{c.patientName}</span>
                      <span className={muted}>{c.patientMrn} · {RELATION[c.relation] ?? c.relation}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
