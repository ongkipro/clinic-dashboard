"use client";
// Component gallery (T-012, PR-86): every base component and state pattern on the
// DESIGN.md tokens, for browser checks at 390/820/1180/1440. Development only: the host
// proxy refuses /dev in production.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  BlockedState,
  EmptyState,
  ErrorState,
  FilteredEmptyState,
  LoadingList,
  PermissionState,
  SuccessNotice,
} from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { checkAccent } from "@/styles/tokens";

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" aria-labelledby={title}>
      <h2 id={title} className="m-0 text-[1.18rem] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Gallery() {
  const [accent, setAccent] = useState("#4FC3F7");
  const result = (() => {
    try {
      return checkAccent(accent);
    } catch {
      return null;
    }
  })();

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
      <Section title="Tombol">
        <div className="flex flex-wrap gap-2">
          <Button>Simpan</Button>
          <Button variant="plain">Batal</Button>
          <Button variant="secondary">Lihat Riwayat</Button>
          <Button variant="outline">Ekspor</Button>
          <Button variant="destructive">Batalkan Janji</Button>
          <Button variant="secondary" disabled>Tidak tersedia</Button>
        </div>
        <div className="max-w-sm">
          <Button size="lg">Terima Pembayaran</Button>
        </div>
      </Section>

      <Section title="Status">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="success">Lunas</StatusBadge>
          <StatusBadge tone="warning">Belum dibayar</StatusBadge>
          <StatusBadge tone="danger">Alergi</StatusBadge>
          <StatusBadge tone="locked">Ditandatangani</StatusBadge>
          <StatusBadge tone="neutral">Draf</StatusBadge>
          <StatusBadge tone="blocked">Terblokir</StatusBadge>
        </div>
      </Section>

      <Section title="Uang dan angka">
        <p className="tabular m-0 text-[1.65rem] font-bold">{rupiah.format(1_250_000)}</p>
        <p className="tabular m-0 text-[var(--label-2)]">Sisa tagihan {rupiah.format(350_000)} · 14.30 WIB</p>
      </Section>

      <Section title="Lembar (sheet)">
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline" className="justify-self-start">Buka Lembar</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Ubah Jadwal</DrawerTitle>
              <DrawerDescription>Pilih jam baru untuk janji ini.</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <Button>Simpan</Button>
              <DrawerClose asChild>
                <Button variant="plain">Batal</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Section>

      <Section title="Keadaan layar">
        <LoadingList label="Memuat daftar pasien" />
        <EmptyState message="Belum ada pasien." action="Daftarkan Pasien" />
        <FilteredEmptyState message="Tidak ada janji untuk filter ini." />
        <ErrorState message="Koneksi terputus." />
        <PermissionState object="log audit" />
        <BlockedState reason="Belum dibayar" unblock="Kasir dapat menerima pembayaran" />
        <SuccessNotice message="Pembayaran diterima." />
      </Section>

      <Section title="Warna aksen klinik">
        <label className="grid min-w-0 max-w-sm grid-cols-[minmax(0,1fr)] gap-1.5">
          <span className="text-[0.94rem] font-semibold">Kode warna</span>
          <input
            className="min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3 font-mono"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
          />
        </label>
        {result === null ? (
          <p className="m-0 text-destructive" role="alert">Masukkan kode warna seperti #0A6E86.</p>
        ) : result.ok ? (
          <p className="m-0 text-success" role="status">Warna dapat dipakai.</p>
        ) : (
          <div role="alert" className="grid gap-1 text-destructive">
            <p className="m-0">
              Kontras kurang:{" "}
              {result.failures.map((f) => `${f.against} ${f.ratio.toFixed(2)}:1`).join(", ")} (minimal 4,5:1).
            </p>
            {result.suggestion && <p className="m-0">Coba {result.suggestion}.</p>}
          </div>
        )}
      </Section>
    </div>
  );
}
