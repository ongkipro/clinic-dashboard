// Saya › Akses Vendor (UX-48, PR-60, TEN-14, IAM-10, SEC-20; 19 §2.16 "Akses Vendor (owner; Admin Pusat
// read)"): approval requests for clinical or personal-data support sessions; every support session with
// its counts and, opened, its access log (windows, refused binds, every record read); the onboarding
// grant (Owner); dual vendor/clinic identities; infrastructure access (no source yet: T-026 Q3). The Owner
// decides; Admin Pusat reads. Vendor-entered strings (operator name, purpose) are React text only.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import type { OwnerSession } from "../../../../modules/vendor/support/scope";
import { type AksesVendorPage, LOG_PAGE, loadAksesVendor } from "./data";
import { RESULT_COOKIE } from "./result-cookie";
import { DualIdentityDecision, EndSession, RevokeDualIdentity, ScopeDecision } from "./forms";

export const metadata: Metadata = { title: "Akses Vendor — Clinic Dashboard" };

const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const at = (s: string | null | undefined) => (s ? fmt.format(new Date(s)) : "—");

const STATE: Record<OwnerSession["state"], { label: string; tone: "warning" | "success" | "neutral" | "danger" }> = {
  pending_approval: { label: "Menunggu persetujuan", tone: "warning" },
  active: { label: "Aktif", tone: "success" },
  expired: { label: "Kedaluwarsa", tone: "neutral" },
  tenant_closed: { label: "Klinik ditutup", tone: "neutral" },
  ended: { label: "Berakhir", tone: "neutral" },
};
const CLASS: Record<string, string> = { config: "konfigurasi", personal: "data pribadi", clinical: "data klinis", money_total: "total uang" };
const END: Record<string, string> = { owner: "diakhiri Owner", operator: "diakhiri petugas vendor", expired: "waktu habis", tenant_closed: "klinik ditutup" };
// support_session_bind refusal codes (0049), plus the vendor guard's (session, role, network).
const REFUSED: Record<string, string> = {
  not_active: "sesi tidak aktif", awaiting_owner: "belum disetujui Owner", not_opener: "bukan petugas yang membuka sesi",
  no_ticket: "tanpa izin akses", ticket_exists: "izin akses ganda", not_found: "sesi tidak ditemukan",
  isolation_not_read_committed: "mode transaksi tidak diizinkan", no_session: "tanpa sesi masuk", role_not_held: "peran tidak sesuai",
  ip_not_allowed: "jaringan tidak diizinkan", totp_not_verified: "verifikasi dua langkah kedaluwarsa", unknown: "alasan tidak tercatat",
};

function scopeText(s: OwnerSession) {
  return s.scope.map((x) => `${x.table.replace(/^public\./, "")} (${CLASS[x.class] ?? x.class})`).join(", ");
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id={id} className="m-0 text-[1.18rem] font-semibold">{title}</h2>
      {lead && <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">{lead}</p>}
      {children}
    </section>
  );
}
const card = "grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function SessionLogView({ log, sessionId }: { log: NonNullable<Extract<AksesVendorPage, { kind: "ok" }>["log"]>; sessionId: string }) {
  const { totals, events } = log.data;
  const next = log.offset + LOG_PAGE;
  const total = totals.windows + totals.refused + totals.reads;
  return (
    <div className="grid gap-2" id={`catatan-${sessionId}`}>
      {events.length === 0 ? (
        <p role="status" className={muted}>Belum ada akses tercatat.</p>
      ) : (
        <ol className="m-0 grid list-none gap-0 p-0" aria-label="Catatan akses sesi">
          {events.map((e, i) => (
            <li key={`${log.offset + i}`} className="grid gap-0.5 border-b border-[var(--separator)] py-2 last:border-b-0 [border-bottom-width:0.5px]">
              {e.kind === "read" ? (
                <span className="[overflow-wrap:anywhere]">
                  Membaca <strong>{e.object_kind.replace(/^public\./, "")}</strong> <code className="text-[0.82rem]">{e.id}</code>
                  {e.row_found === false && <span className="text-[var(--warning)]"> · data tidak ada lagi di klinik ini</span>}
                </span>
              ) : e.kind === "window" ? (
                <span>Jendela akses dibuka{e.used_at ? "" : " (tidak dipakai)"}</span>
              ) : (
                <span className="text-[var(--danger)]">Akses ditolak: {REFUSED[e.reason] ?? e.reason}</span>
              )}
              <span className={muted}>{at(e.at)}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-3">
        {log.offset > 0 && (
          <Link className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]" href={`?sesi=${sessionId}&dari=${Math.max(0, log.offset - LOG_PAGE)}#catatan-${sessionId}`}>
            Sebelumnya
          </Link>
        )}
        {next < total && (
          <Link className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]" href={`?sesi=${sessionId}&dari=${next}#catatan-${sessionId}`}>
            Berikutnya
          </Link>
        )}
      </div>
    </div>
  );
}

// Counts and the access log of one session (also for a session waiting for approval: refused binds
// before the decision are visible to the Owner deciding).
function SessionCounts({ s, log }: { s: OwnerSession; log: Extract<AksesVendorPage, { kind: "ok" }>["log"] }) {
  return (
    <>
      <p className={muted}>{s.access_windows} jendela akses · {s.refused_reads} ditolak · {s.records_read} data dibaca</p>
      {log?.sessionId === s.id ? (
        <SessionLogView log={log} sessionId={s.id} />
      ) : (
        <Link className="inline-flex min-h-[var(--target)] items-center justify-self-start font-semibold text-[var(--tint)]" href={`?sesi=${s.id}#catatan-${s.id}`} aria-label={`Lihat catatan sesi ${s.operator}`}>
          Lihat catatan
        </Link>
      )}
    </>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const p = await loadAksesVendor({ sesi: one(q.sesi), dari: one(q.dari), result: (await cookies()).get(RESULT_COOKIE)?.value });
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="akses vendor" />;
  const pending = p.sessions.filter((s) => s.needs_approval);
  // A session waiting for the Owner is shown once, under Persetujuan akses.
  const others = p.sessions.filter((s) => !s.needs_approval);
  const result = p.result;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
      {result && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{result}</p>}
      {!p.isOwner && <p role="status" className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">Hanya baca. Owner yang memutuskan akses vendor.</p>}

      <Section id="persetujuan" title="Persetujuan akses" lead="Sesi yang menyentuh data pribadi atau klinis baru aktif setelah Owner menyetujuinya.">
        {pending.length === 0 ? (
          <p role="status" className={`${card} text-[var(--label-2)]`}>Tidak ada permintaan yang menunggu.</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0" aria-label="Permintaan akses yang menunggu">
            {pending.map((s) => (
              <li key={s.id} className={card}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{s.operator}</span>
                  <StatusBadge tone="warning">Menunggu persetujuan</StatusBadge>
                </div>
                <p className="m-0 [overflow-wrap:anywhere]">Tujuan: {s.purpose}</p>
                <p className={muted}>Data: {scopeText(s)} · {s.minutes} menit setelah disetujui · diajukan {at(s.requested_at)}</p>
                <SessionCounts s={s} log={p.log} />
                {p.isOwner && <ScopeDecision sessionId={s.id} ctx={p.ctx} label={s.operator} />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="sesi" title="Sesi dukungan" lead="Setiap sesi vendor ke klinik ini, terbaru dulu (yang menunggu persetujuan ada di atas). Buka catatan untuk melihat setiap data yang dibaca.">
        {others.length === 0 ? (
          <p role="status" className={`${card} text-[var(--label-2)]`}>{p.sessions.length === 0 ? "Belum pernah ada sesi dukungan." : "Belum ada sesi lain."}</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0" aria-label="Sesi dukungan">
            {others.map((s) => {
              return (
                <li key={s.id} className={card}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">{s.operator}</span>
                    <StatusBadge tone={STATE[s.state].tone}>{STATE[s.state].label}</StatusBadge>
                  </div>
                  <p className="m-0 [overflow-wrap:anywhere]">Tujuan: {s.purpose}</p>
                  <p className={muted}>Data: {scopeText(s)}</p>
                  <p className={muted}>
                    Diajukan {at(s.requested_at)}
                    {s.activated_at ? ` · aktif ${at(s.activated_at)}` : ""}
                    {s.ends_at ? ` · sampai ${at(s.ends_at)}` : ""}
                    {s.ended_at ? ` · berakhir ${at(s.ended_at)}${s.end_reason ? ` (${END[s.end_reason] ?? s.end_reason})` : ""}` : ""}
                  </p>
                  {s.extension_reason && <p className={muted}>Diperpanjang: {s.extension_reason}</p>}
                  <SessionCounts s={s} log={p.log} />
                  {p.isOwner && s.state === "active" && <EndSession sessionId={s.id} ctx={p.ctx} label={s.operator} />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {p.isOwner && (
        <Section id="onboarding" title="Akses onboarding" lead="Tim onboarding vendor hanya dapat menyiapkan konfigurasi selama akses ini berlaku.">
          {!p.grant?.grant ? (
            <p role="status" className={`${card} text-[var(--label-2)]`}>Tidak ada akses onboarding.</p>
          ) : (
            <div className={card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">Akses onboarding vendor</span>
                <StatusBadge tone={p.grant.grant.active ? "success" : "neutral"}>{p.grant.grant.active ? "Berlaku" : "Berakhir"}</StatusBadge>
              </div>
              <p className={muted}>
                Diberikan {at(p.grant.grant.granted_at)} · berlaku sampai {at(p.grant.grant.expires_at)}
                {p.grant.grant.renewed ? " · sudah diperpanjang" : ""}
                {p.grant.grant.ended_at ? ` · berakhir ${at(p.grant.grant.ended_at)}${p.grant.grant.end_reason === "go_live" ? " (klinik live)" : ""}` : ""}
              </p>
              {p.grant.drafts.length > 0 && (
                <p className="m-0">
                  {p.grant.drafts.length} undangan staf dari vendor menunggu konfirmasi Anda di{" "}
                  <Link className="font-semibold text-[var(--tint)]" href="/staf?segmen=undangan">Staf &amp; Undangan</Link>.
                </p>
              )}
            </div>
          )}
        </Section>
      )}

      <Section id="identitas" title="Identitas ganda" lead="Akun yang sekaligus staf vendor dan staf klinik ini butuh persetujuan Pemilik Platform dan Owner. Owner dapat mencabutnya kapan saja; akun itu langsung berhenti menjadi staf klinik ini.">
        {p.dual.length === 0 ? (
          <p role="status" className={`${card} text-[var(--label-2)]`}>Tidak ada identitas ganda.</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0" aria-label="Identitas ganda">
            {p.dual.map((d) => (
              <li key={d.requestId} className={card}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{d.vendorName ?? "Akun vendor"}</span>
                  <StatusBadge tone={d.effective ? "success" : d.revokedAt || d.state === "rejected" || d.state === "cancelled" ? "neutral" : "warning"}>
                    {d.effective ? "Berlaku" : d.revokedAt ? "Dicabut" : d.state === "rejected" ? "Ditolak" : d.state === "cancelled" ? "Dibatalkan" : d.clinicApprovedAt ? "Menunggu Pemilik Platform" : "Menunggu Owner"}
                  </StatusBadge>
                </div>
                <p className={muted}>
                  Diajukan {fmt.format(d.requestedAt)} · Pemilik Platform: {d.platformDecidedAt ? `memutuskan ${fmt.format(d.platformDecidedAt)}` : "belum memutuskan"} · Owner: {d.clinicApprovedAt ? `menyetujui ${fmt.format(d.clinicApprovedAt)}` : "belum menyetujui"}
                  {d.revokedAt ? ` · dicabut Owner ${fmt.format(d.revokedAt)}` : ""}
                </p>
                {p.isOwner && !d.clinicApprovedAt && (d.state === "pending" || d.state === "approved") && (
                  <DualIdentityDecision requestId={d.requestId} ctx={p.ctx} label={d.vendorName ?? "akun vendor"} />
                )}
                {p.isOwner && d.effective && <RevokeDualIdentity requestId={d.requestId} ctx={p.ctx} label={d.vendorName ?? "akun vendor"} />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="infrastruktur" title="Akses infrastruktur">
        <p role="status" className={`${card} text-[var(--label-2)]`}>
          Akses teknisi vendor ke server, database dan cadangan akan tampil di sini setelah pencatatannya aktif saat sistem dipasang (SEC-20). Saat ini belum ada catatan.
        </p>
      </Section>
    </div>
  );
}

export default function AksesVendorPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[880px] min-w-0 gap-6">
      <PageTitle title="Akses Vendor" />
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
