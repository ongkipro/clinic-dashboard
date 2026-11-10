// Surat (19:92, PR-74; T-058): the letters at the active branch — the doctor's own in the last 30 days, every
// letter for the facility head and records officer — with draft or signed state; "Buat Surat" for doctors.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadLetters } from "../data";
import { LETTER_TYPE_LABEL } from "../labels";

export const metadata: Metadata = { title: "Surat — Clinic Dashboard" };

const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

async function Body() {
  const d = await loadLetters();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="surat" />;
  if (d.kind === "no-branch") return <ListPage as="section" title="Surat" state={{ kind: "empty", message: "Pilih cabang aktif di Saya › Ganti Cabang." }} />;
  const doctor = d.role === "doctor";
  return (
    <ListPage as="section" title="Surat" primaryAction={doctor ? { label: "Buat Surat", href: "/templat/surat/baru" } : undefined}
      state={d.letters.length === 0 ? { kind: "empty", message: doctor ? "Belum ada surat yang Anda buat dalam 30 hari terakhir." : "Belum ada surat dalam 30 hari terakhir.",
        ...(doctor ? { action: "Buat Surat", actionHref: "/templat/surat/baru" } : {}) } : { kind: "rows" }}>
      <RowList label="Surat">
        {d.letters.map((l) => (
          <Row key={l.id} href={`/templat/surat/${l.id}`} title={l.patient_name}
            subtitle={`${l.patient_mrn} · ${LETTER_TYPE_LABEL[l.letter_type]} · ${l.author_name} · ${when(l.signed_at ?? l.created_at)}${l.version ? ` · versi ${l.version}` : ""}`}>
            {/* A short badge word: "Ditandatangani" alone overflowed the row at 390 px with 200 % text (the row keeps a fixed right gutter). */}
            <StatusBadge tone={l.state === "signed" ? "locked" : "neutral"}>{l.state === "signed" ? "Tertanda" : "Draf"}</StatusBadge>
          </Row>
        ))}
      </RowList>
    </ListPage>
  );
}

export default function SuratPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body />
      </Suspense>
    </main>
  );
}
