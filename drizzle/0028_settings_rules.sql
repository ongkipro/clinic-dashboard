-- T-017 (PR-38, DATA-44, B-24, P-22). setting_defs is a platform registry (rows below, from
-- src/modules/settings/registry.ts; tests/settings keep them equal). setting_versions is
-- tenant-shared and append-only; clinic_app reads it and writes only through the
-- functions below, which take the actor from the bound context, check scope, changers and
-- bounds (setting_value_ok, the SQL twin of src/modules/settings/spec.ts), snapshot the
-- actor's name, audit, and emit SettingChanged. Drafts go through the approvals engine
-- (types setting_change_owner / setting_change_fh) and are applied atomically when the
-- approver decides them here (setting_draft_decide).
ALTER TABLE public.setting_defs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

INSERT INTO public.setting_defs (key, group_slug, label, kind, scope, spec, default_value, changers, drafts) VALUES
  ('SET-1', 'klinik', 'Profil klinik (nama tampil, warna aksen)', 'value', 'tenant', '{"t":"obj","f":[{"k":"nama","l":"Nama tampil","s":{"t":"opt","of":{"t":"text","min":2,"max":60,"hint":"2–60 karakter"},"off":"Nama PT"}},{"k":"aksen","l":"Warna aksen","s":{"t":"accent"}}]}'::jsonb, '{"nama":null,"aksen":"#0A6E86"}'::jsonb, ARRAY['owner','admin_pusat']::text[], '[]'::jsonb),
  ('SET-2', 'klinik', 'Jam buka, hari libur, tutup khusus', 'ref', 'branch', NULL, NULL, ARRAY['admin_pusat','manager','owner']::text[], '[]'::jsonb),
  ('SET-3', 'klinik', 'Zona waktu cabang', 'ref', 'branch', NULL, NULL, ARRAY['admin_pusat','owner']::text[], '[]'::jsonb),
  ('SET-46', 'klinik', 'Data izin klinik per cabang (nomor izin, NIB, penanggung jawab, ID SATUSEHAT)', 'ref', 'branch', NULL, NULL, ARRAY['owner','admin_pusat']::text[], '[]'::jsonb),
  ('SET-4', 'layanan', 'Durasi default persiapan, tindakan, jeda', 'value', 'tenant', '{"t":"obj","f":[{"k":"persiapan","l":"Persiapan","s":{"t":"int","min":0,"max":120,"unit":"menit"}},{"k":"tindakan","l":"Tindakan","s":{"t":"int","min":5,"max":480,"unit":"menit"}},{"k":"jeda","l":"Jeda","s":{"t":"int","min":0,"max":120,"unit":"menit"}}]}'::jsonb, '{"persiapan":10,"tindakan":30,"jeda":10}'::jsonb, ARRAY['admin_pusat','owner']::text[], '[]'::jsonb),
  ('SET-5', 'layanan', 'Harga cabang (override)', 'ref', 'branch', NULL, NULL, ARRAY['owner']::text[], '[]'::jsonb),
  ('SET-6', 'uang', 'Biaya konsultasi', 'value', 'tenant', '{"t":"opt","of":{"t":"rupiah","min":1},"off":"Belum diisi"}'::jsonb, 'null'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-7', 'uang', 'Kontrol gratis per item', 'value', 'tenant', '{"t":"obj","f":[{"k":"jumlah","l":"Jumlah kontrol","s":{"t":"int","min":0,"max":5,"unit":"kali"}},{"k":"hari","l":"Berlaku sampai tanggal kontrol +","s":{"t":"int","min":0,"max":30,"unit":"hari"}}]}'::jsonb, '{"jumlah":1,"hari":7}'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-8', 'uang', 'Masa berlaku paket default', 'value', 'tenant', '{"t":"int","min":30,"max":1095,"unit":"hari"}'::jsonb, '365'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-9', 'uang', 'DP minimum paket default, cicilan diizinkan default', 'value', 'tenant', '{"t":"obj","f":[{"k":"dp_minimum","l":"DP minimum","s":{"t":"opt","of":{"t":"int","min":0,"max":100,"unit":"%"},"off":"Kosong"}},{"k":"cicilan","l":"Cicilan","s":{"t":"bool","on":"Diizinkan","off":"Tidak diizinkan"}}]}'::jsonb, '{"dp_minimum":null,"cicilan":true}'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-10', 'uang', 'DP booking & batas ubah jadwal', 'value', 'tenant', '{"t":"obj","f":[{"k":"dp_booking","l":"DP booking","s":{"t":"bool"}},{"k":"batas_ubah","l":"Batas ubah jadwal","s":{"t":"int","min":0,"max":72,"unit":"jam"}}]}'::jsonb, '{"dp_booking":false,"batas_ubah":24}'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-11', 'uang', 'Penyetuju refund tunai', 'value', 'tenant', '{"t":"enum","of":[{"v":"owner","l":"Owner"},{"v":"owner_manager","l":"Owner + Manajer"}]}'::jsonb, '"owner"'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-12', 'uang', 'Batas diskon manual per peran', 'value', 'tenant', '{"t":"obj","f":[{"k":"fo_persen","l":"FO/Kasir","s":{"t":"int","min":0,"max":100,"unit":"%"}},{"k":"manajer_persen","l":"Manajer (persen)","s":{"t":"int","min":0,"max":100,"unit":"%"}},{"k":"manajer_rupiah","l":"Manajer (rupiah)","s":{"t":"rupiah","min":0}}]}'::jsonb, '{"fo_persen":0,"manajer_persen":10,"manajer_rupiah":500000}'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-13', 'uang', 'Ambang selisih kas untuk eskalasi ke owner', 'value', 'branch', '{"t":"rupiah","min":0,"max":1000000}'::jsonb, '50000'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-14', 'uang', 'Metode bayar aktif, provider, masa berlaku link bayar', 'value', 'tenant', '{"t":"obj","f":[{"k":"metode","l":"Metode bayar","s":{"t":"list","min":1,"max":5,"unique":true,"of":{"t":"enum","of":[{"v":"tunai","l":"Tunai"},{"v":"qris","l":"QRIS"},{"v":"edc","l":"EDC"},{"v":"transfer","l":"Transfer"},{"v":"saldo","l":"Saldo"}]}}},{"k":"provider","l":"Provider","s":{"t":"enum","of":[{"v":"mock","l":"Mock (belum ada mitra)"}]}},{"k":"link_jam","l":"Masa berlaku link bayar","s":{"t":"int","min":1,"max":72,"unit":"jam"}}]}'::jsonb, '{"metode":["tunai","qris","edc","transfer","saldo"],"provider":"mock","link_jam":24}'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-41', 'uang', 'Cicilan maksimum, tanggal mundur', 'value', 'tenant', '{"t":"obj","f":[{"k":"cicilan_maks","l":"Cicilan maksimum","s":{"t":"opt","of":{"t":"int","min":2,"max":24,"unit":"kali"},"off":"Tanpa batas"}},{"k":"mundur","l":"Tanggal mundur (dengan persetujuan)","s":{"t":"int","min":0,"max":3,"unit":"hari"}}]}'::jsonb, '{"cicilan_maks":null,"mundur":1}'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-43', 'uang', 'Matriks persetujuan: void, selisih opname, PO, pemusnahan', 'value', 'tenant', '{"t":"obj","f":[{"k":"void","l":"Penyetuju void","s":{"t":"enum","of":[{"v":"manajer_hari_sama","l":"Manajer di hari yang sama, setelahnya owner"},{"v":"owner","l":"Selalu owner"}]}},{"k":"selisih_opname","l":"Ambang selisih opname","s":{"t":"int","min":0,"max":100,"unit":"%"}},{"k":"po_owner","l":"PO perlu owner mulai","s":{"t":"rupiah","min":0}},{"k":"musnah_kedua_kejadian","l":"Pemusnahan: persetujuan kedua mulai (per kejadian)","s":{"t":"rupiah","min":0}},{"k":"musnah_kedua_bulan","l":"Pemusnahan: persetujuan kedua mulai (per bulan)","s":{"t":"rupiah","min":0}},{"k":"musnah_owner","l":"Pemusnahan: owner mulai","s":{"t":"rupiah","min":0}}],"le":[["musnah_kedua_kejadian","musnah_owner"],["musnah_kedua_kejadian","musnah_kedua_bulan"]]}'::jsonb, '{"void":"manajer_hari_sama","selisih_opname":2,"po_owner":10000000,"musnah_kedua_kejadian":1000000,"musnah_kedua_bulan":5000000,"musnah_owner":10000000}'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-49', 'uang', 'Perpanjangan paket oleh manajer', 'value', 'tenant', '{"t":"int","min":0,"max":90,"unit":"hari"}'::jsonb, '90'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-39', 'pajak', 'Status PKP dan tanggal efektif; kategori pajak per item; pembulatan', 'ref', 'tenant', NULL, NULL, ARRAY['owner']::text[], '[]'::jsonb),
  ('SET-15', 'jadwal', 'Lepas slot bila terlambat', 'value', 'branch', '{"t":"opt","of":{"t":"int","min":5,"max":60,"unit":"menit"},"off":"Nonaktif"}'::jsonb, 'null'::jsonb, ARRAY['manager','owner']::text[], '[]'::jsonb),
  ('SET-16', 'jadwal', 'Booking online: horizon, batas H-, DP pasien baru', 'value', 'branch', '{"t":"obj","f":[{"k":"horizon","l":"Horizon","s":{"t":"int","min":1,"max":90,"unit":"hari"}},{"k":"batas","l":"Batas sebelum jadwal","s":{"t":"int","min":0,"max":48,"unit":"jam"}},{"k":"dp_pasien_baru","l":"DP wajib pasien baru","s":{"t":"bool"}}]}'::jsonb, '{"horizon":30,"batas":2,"dp_pasien_baru":false}'::jsonb, ARRAY['admin_pusat','owner']::text[], '[]'::jsonb),
  ('SET-17', 'jadwal', 'Tahan slot saat bayar DP', 'value', 'tenant', '{"t":"int","min":5,"max":30,"unit":"menit"}'::jsonb, '10'::jsonb, ARRAY['admin_pusat','owner']::text[], '[]'::jsonb),
  ('SET-38', 'jadwal', 'Peringatan pasien menunggu', 'value', 'branch', '{"t":"int","min":5,"max":120,"unit":"menit"}'::jsonb, '20'::jsonb, ARRAY['manager','owner']::text[], '[]'::jsonb),
  ('SET-40', 'antrean', 'Prefiks nomor, panggilan suara, orientasi TV', 'value', 'branch', '{"t":"obj","f":[{"k":"prefiks_loket","l":"Prefiks loket","s":{"t":"text","min":1,"max":3,"pattern":"^[A-Z]{1,3}$","hint":"1–3 huruf kapital"}},{"k":"prefiks_ruang","l":"Prefiks ruang","s":{"t":"text","min":1,"max":3,"pattern":"^[A-Z]{1,3}$","hint":"1–3 huruf kapital"}},{"k":"suara","l":"Panggilan suara","s":{"t":"bool"}},{"k":"orientasi","l":"Orientasi TV","s":{"t":"enum","of":[{"v":"landscape","l":"Mendatar"},{"v":"portrait","l":"Tegak"}]}}]}'::jsonb, '{"prefiks_loket":"A","prefiks_ruang":"B","suara":false,"orientasi":"landscape"}'::jsonb, ARRAY['manager','owner']::text[], '[]'::jsonb),
  ('SET-18', 'komunikasi', 'Jam kirim pengingat janji', 'value', 'branch', '{"t":"obj","f":[{"k":"h1","l":"H-1 pukul","s":{"t":"time","min":"07:00","max":"21:00"}},{"k":"sebelum","l":"Hari H, sebelum jadwal","s":{"t":"int","min":1,"max":12,"unit":"jam"}}]}'::jsonb, '{"h1":"10:00","sebelum":2}'::jsonb, ARRAY['admin_pusat','owner']::text[], '[]'::jsonb),
  ('SET-19', 'komunikasi', 'Skenario otomasi pesan', 'value', 'tenant', '{"t":"obj","f":[{"k":"aftercare","l":"Aftercare (H+)","s":{"t":"opt","of":{"t":"int","min":0,"max":60,"unit":"hari"},"off":"Nonaktif"}},{"k":"kepuasan","l":"Tindak lanjut kepuasan (H+)","s":{"t":"opt","of":{"t":"int","min":0,"max":60,"unit":"hari"},"off":"Nonaktif"}},{"k":"rencana","l":"Tindak lanjut rencana (H+)","s":{"t":"opt","of":{"t":"int","min":0,"max":60,"unit":"hari"},"off":"Nonaktif"}},{"k":"belum_jadwal","l":"Belum ada jadwal (H+)","s":{"t":"opt","of":{"t":"int","min":0,"max":60,"unit":"hari"},"off":"Nonaktif"}},{"k":"pengingat","l":"Pengingat janji (H-)","s":{"t":"opt","of":{"t":"int","min":0,"max":60,"unit":"hari"},"off":"Nonaktif"}},{"k":"isi_ulang","l":"Isi ulang produk (H- perkiraan habis)","s":{"t":"opt","of":{"t":"int","min":0,"max":60,"unit":"hari"},"off":"Nonaktif"}},{"k":"ulang_tahun","l":"Ucapan ulang tahun","s":{"t":"bool"}},{"k":"batas_harian","l":"Batas pesan per pasien","s":{"t":"int","min":1,"max":5,"unit":"pesan/hari"}}]}'::jsonb, '{"aftercare":1,"kepuasan":7,"rencana":14,"belum_jadwal":21,"pengingat":3,"isi_ulang":5,"ulang_tahun":false,"batas_harian":2}'::jsonb, ARRAY['admin_pusat','owner']::text[], '[]'::jsonb),
  ('SET-20', 'komunikasi', 'SLA respons lead', 'value', 'tenant', '{"t":"int","min":5,"max":120,"unit":"menit"}'::jsonb, '15'::jsonb, ARRAY['owner']::text[], '[]'::jsonb),
  ('SET-21', 'komunikasi', 'Batas kirim harian WhatsApp', 'value', 'tenant', '{"t":"int","min":10,"max":90,"unit":"% batas Meta"}'::jsonb, '80'::jsonb, ARRAY['owner']::text[], '[]'::jsonb),
  ('SET-42', 'komunikasi', 'Penugasan percakapan baru', 'value', 'tenant', '{"t":"enum","of":[{"v":"manual","l":"Manual"},{"v":"bergilir","l":"Bergilir per cabang"}]}'::jsonb, '"manual"'::jsonb, ARRAY['admin_pusat','owner']::text[], '[]'::jsonb),
  ('SET-22', 'crm', 'Jendela kunjungan kedua / pasien lama tidak datang', 'value', 'tenant', '{"t":"obj","f":[{"k":"kunjungan_kedua","l":"Kunjungan kedua","s":{"t":"int","min":14,"max":365,"unit":"hari"}},{"k":"tidak_datang","l":"Tidak datang","s":{"t":"int","min":14,"max":365,"unit":"hari"}}],"lt":[["kunjungan_kedua","tidak_datang"]]}'::jsonb, '{"kunjungan_kedua":60,"tidak_datang":90}'::jsonb, ARRAY['owner']::text[], '[]'::jsonb),
  ('SET-23', 'crm', 'Pengingat paket hampir habis', 'value', 'tenant', '{"t":"list","min":1,"max":3,"desc":true,"of":{"t":"int","min":1,"max":90,"unit":"hari"}}'::jsonb, '[30,14,7]'::jsonb, ARRAY['admin_pusat','owner']::text[], '[]'::jsonb),
  ('SET-24', 'komisi', 'Aturan & nilai komisi', 'ref', 'tenant', NULL, NULL, ARRAY['owner']::text[], '[]'::jsonb),
  ('SET-25', 'komisi', 'Metrik target BC, periode target', 'value', 'tenant', '{"t":"obj","f":[{"k":"metrik","l":"Metrik","s":{"t":"enum","of":[{"v":"closing_rencana","l":"Nilai closing/bulan + rencana terpilih penuh"}]}},{"k":"periode","l":"Periode","s":{"t":"enum","of":[{"v":"bulanan","l":"Bulanan"},{"v":"triwulan","l":"Triwulan"}]}}]}'::jsonb, '{"metrik":"closing_rencana","periode":"bulanan"}'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-44', 'komisi', 'Hari tutup batch komisi bulanan', 'value', 'tenant', '{"t":"oneof","of":[{"k":"month_end","l":"Akhir bulan"},{"k":"day","l":"Tanggal","s":{"t":"int","min":1,"max":28,"unit":""}}]}'::jsonb, '{"k":"month_end"}'::jsonb, ARRAY['owner']::text[], '[{"by":"admin_pusat","approver":"owner"}]'::jsonb),
  ('SET-26', 'stok', 'Stok minimum/target per item per cabang', 'ref', 'branch', NULL, NULL, ARRAY['pharmacist','purchasing','owner']::text[], '[]'::jsonb),
  ('SET-27', 'stok', 'Jadwal hitung stok; peringatan hampir kedaluwarsa', 'value', 'branch', '{"t":"obj","f":[{"k":"nilai_tinggi","l":"Hitung item nilai tinggi","s":{"t":"enum","of":[{"v":"harian","l":"Harian"},{"v":"mingguan","l":"Mingguan"},{"v":"bulanan","l":"Bulanan"}]}},{"k":"lainnya","l":"Hitung item lain","s":{"t":"enum","of":[{"v":"harian","l":"Harian"},{"v":"mingguan","l":"Mingguan"},{"v":"bulanan","l":"Bulanan"}]}},{"k":"kedaluwarsa","l":"Peringatan hampir kedaluwarsa","s":{"t":"int","min":7,"max":180,"unit":"hari"}}]}'::jsonb, '{"nilai_tinggi":"mingguan","lainnya":"bulanan","kedaluwarsa":30}'::jsonb, ARRAY['manager','pharmacist','owner']::text[], '[]'::jsonb),
  ('SET-28', 'klinis', 'Templat catatan per perawatan', 'ref', 'tenant', NULL, NULL, ARRAY['facility_head','owner']::text[], '[]'::jsonb),
  ('SET-29', 'klinis', 'Protokol foto (sudut)', 'value', 'tenant', '{"t":"list","min":1,"max":6,"unique":true,"of":{"t":"enum","of":[{"v":"depan","l":"Depan"},{"v":"serong_45","l":"Serong 45°"},{"v":"samping","l":"Samping"},{"v":"atas","l":"Atas"},{"v":"bawah","l":"Bawah (dagu)"},{"v":"dekat","l":"Close-up area"}]}}'::jsonb, '["depan","serong_45","samping"]'::jsonb, ARRAY['facility_head','owner']::text[], '[]'::jsonb),
  ('SET-30', 'klinis', 'Matriks delegasi', 'ref', 'tenant', NULL, NULL, ARRAY['facility_head','owner']::text[], '[]'::jsonb),
  ('SET-31', 'klinis', 'Target respons keluhan klinis (triase)', 'value', 'tenant', '{"t":"obj","f":[{"k":"merah","l":"Merah","s":{"t":"int","min":5,"max":60,"unit":"menit"}},{"k":"kuning","l":"Kuning","s":{"t":"int","min":30,"max":240,"unit":"menit"}},{"k":"hijau","l":"Hijau","s":{"t":"int","min":4,"max":24,"unit":"jam kerja"}}],"lt":[["merah","kuning"]]}'::jsonb, '{"merah":15,"kuning":120,"hijau":8}'::jsonb, ARRAY['facility_head','owner']::text[], '[]'::jsonb),
  ('SET-31.layanan', 'klinis', 'Target respons keluhan layanan', 'value', 'tenant', '{"t":"int","min":1,"max":24,"unit":"jam kerja"}'::jsonb, '8'::jsonb, ARRAY['owner']::text[], '[]'::jsonb),
  ('SET-47', 'klinis', 'Masa berlaku persetujuan tindakan', 'value', 'tenant', '{"t":"int","min":30,"max":365,"unit":"hari"}'::jsonb, '90'::jsonb, ARRAY['facility_head','owner']::text[], '[]'::jsonb),
  ('SET-48', 'klinis', 'Masa berlaku resep; jeda isi ulang; penyerahan sebagian', 'value', 'tenant', '{"t":"obj","f":[{"k":"masa","l":"Masa berlaku","s":{"t":"int","min":3,"max":90,"unit":"hari"}},{"k":"masa_akut","l":"Masa berlaku resep akut","s":{"t":"int","min":3,"max":90,"unit":"hari"}},{"k":"jeda","l":"Jeda isi ulang","s":{"t":"int","min":50,"max":95,"unit":"% perkiraan hari pakai"}},{"k":"sebagian","l":"Penyerahan sebagian","s":{"t":"int","min":1,"max":4,"unit":"kali"}}]}'::jsonb, '{"masa":30,"masa_akut":7,"jeda":75,"sebagian":4}'::jsonb, ARRAY[]::text[], '[{"by":"pharmacist","approver":"facility_head"}]'::jsonb),
  ('SET-32', 'dokumen', 'Templat struk, persetujuan, surat, halaman legal; ukuran kertas struk', 'ref', 'tenant', NULL, NULL, ARRAY['admin_pusat','facility_head','owner']::text[], '[]'::jsonb),
  ('SET-33', 'dokumen', 'Format nomor RM, invoice, PO', 'ref', 'tenant', NULL, NULL, ARRAY['admin_pusat','owner']::text[], '[]'::jsonb),
  ('SET-34', 'akses', 'Peran per staf, cabang', 'ref', 'tenant', NULL, NULL, ARRAY['owner','admin_pusat']::text[], '[]'::jsonb),
  ('SET-35', 'akses', 'Batas waktu sesi perangkat non-FO; metode tanda tangan klinis', 'value', 'tenant', '{"t":"obj","f":[{"k":"batas_sesi","l":"Batas waktu sesi","s":{"t":"int","min":5,"max":60,"unit":"menit"}},{"k":"tanda_tangan","l":"Tanda tangan klinis","s":{"t":"enum","of":[{"v":"pin","l":"PIN"},{"v":"otp","l":"OTP"}]}}]}'::jsonb, '{"batas_sesi":15,"tanda_tangan":"pin"}'::jsonb, ARRAY['owner']::text[], '[]'::jsonb),
  ('SET-45', 'privasi', 'Teks dan tujuan persetujuan (versi)', 'ref', 'tenant', NULL, NULL, ARRAY['owner']::text[], '[]'::jsonb),
  ('SET-36', 'situs', 'Bagian situs aktif, harga tampil per perawatan', 'ref', 'tenant', NULL, NULL, ARRAY['admin_pusat','marketing','owner']::text[], '[]'::jsonb),
  ('SET-37', 'laporan', 'Ringkasan harian ke owner, penerima laporan terjadwal', 'value', 'tenant', '{"t":"obj","f":[{"k":"ringkasan","l":"Ringkasan harian pukul","s":{"t":"opt","of":{"t":"time","min":"17:00","max":"23:00"},"off":"Nonaktif"}},{"k":"penerima","l":"Penerima laporan terjadwal","s":{"t":"list","min":1,"max":4,"unique":true,"of":{"t":"enum","of":[{"v":"owner","l":"Owner"},{"v":"admin_pusat","l":"Admin Pusat"},{"v":"finance","l":"Keuangan"},{"v":"manager","l":"Manajer"}]}}}]}'::jsonb, '{"ringkasan":null,"penerima":["owner"]}'::jsonb, ARRAY['owner']::text[], '[]'::jsonb);--> statement-breakpoint

-- WCAG relative luminance of one sRGB channel value 0..255.
CREATE FUNCTION public.setting_channel(c double precision) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN c / 255 <= 0.04045 THEN c / 255 / 12.92 ELSE power((c / 255 + 0.055) / 1.055, 2.4) END
$$;--> statement-breakpoint
-- UI-2: the worst contrast of an accent against white, #F2F2F7, its 12% soft tint and
-- #EBEBEB (bar glass over black). Twin of accentWorstRatio in spec.ts.
CREATE FUNCTION public.setting_accent_ratio(p_hex text) RETURNS double precision
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r double precision := ('x' || substr(p_hex, 2, 2))::bit(8)::int;
  g double precision := ('x' || substr(p_hex, 4, 2))::bit(8)::int;
  b double precision := ('x' || substr(p_hex, 6, 2))::bit(8)::int;
  l double precision;
  soft double precision;
  worst double precision := 99;
  other double precision;
BEGIN
  l := 0.2126 * public.setting_channel(r) + 0.7152 * public.setting_channel(g) + 0.0722 * public.setting_channel(b);
  soft := 0.2126 * public.setting_channel(0.12 * r + 0.88 * 255) + 0.7152 * public.setting_channel(0.12 * g + 0.88 * 255)
        + 0.0722 * public.setting_channel(0.12 * b + 0.88 * 255);
  FOREACH other IN ARRAY ARRAY[1.0,
      0.2126 * public.setting_channel(242) + 0.7152 * public.setting_channel(242) + 0.0722 * public.setting_channel(247),
      soft,
      public.setting_channel(235)] LOOP
    worst := least(worst, (greatest(l, other) + 0.05) / (least(l, other) + 0.05));
  END LOOP;
  RETURN worst;
END
$$;--> statement-breakpoint

-- Does v fit the value spec s (src/modules/settings/spec.ts)? The server refuses with the
-- bound named before calling; this is the database's own guard.
CREATE FUNCTION public.setting_value_ok(s jsonb, v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t text := s ->> 't';
  f jsonb;
  e jsonb;
  c jsonb;
  pair jsonb;
  prev numeric;
  n numeric;
BEGIN
  IF v IS NULL THEN
    RETURN false;
  END IF;
  CASE t
    WHEN 'int', 'rupiah' THEN
      IF jsonb_typeof(v) <> 'number' THEN RETURN false; END IF;
      n := (v #>> '{}')::numeric;
      RETURN coalesce(n = trunc(n) AND abs(n) <= 9007199254740991 AND n >= (s ->> 'min')::numeric
             AND (s ->> 'max' IS NULL OR n <= (s ->> 'max')::numeric), false);
    WHEN 'bool' THEN
      RETURN jsonb_typeof(v) = 'boolean';
    WHEN 'enum' THEN
      RETURN jsonb_typeof(v) = 'string' AND EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'of') o WHERE o -> 'v' = v);
    WHEN 'time' THEN
      RETURN coalesce(jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
             AND (v #>> '{}') COLLATE "C" >= (s ->> 'min') AND (v #>> '{}') COLLATE "C" <= (s ->> 'max'), false);
    WHEN 'text' THEN
      -- No leading/trailing whitespace of any kind; length in code points (the TS side counts
      -- code points too).
      RETURN coalesce(jsonb_typeof(v) = 'string' AND (v #>> '{}') !~ '^[\t-\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]|[\t-\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]$'
             AND length(v #>> '{}') BETWEEN (s ->> 'min')::int AND (s ->> 'max')::int
             AND (s ->> 'pattern' IS NULL OR (v #>> '{}') ~ (s ->> 'pattern')), false);
    WHEN 'accent' THEN
      -- Upper-case hex only (one spelling per colour); the ratio rounded down to 2 decimals.
      RETURN jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^#[0-9A-F]{6}$' AND floor(public.setting_accent_ratio(v #>> '{}') * 100) >= 450;
    WHEN 'obj' THEN
      IF jsonb_typeof(v) <> 'object' THEN RETURN false; END IF;
      IF (SELECT count(*) FROM jsonb_object_keys(v)) <> jsonb_array_length(s -> 'f') THEN RETURN false; END IF;
      FOR f IN SELECT * FROM jsonb_array_elements(s -> 'f') LOOP
        IF NOT v ? (f ->> 'k') OR public.setting_value_ok(f -> 's', v -> (f ->> 'k')) IS NOT TRUE THEN RETURN false; END IF;
      END LOOP;
      -- Ordered pairs compare only when both sides are set (an "off" optional side is free).
      FOR pair IN SELECT * FROM jsonb_array_elements(coalesce(s -> 'lt', '[]')) LOOP
        IF jsonb_typeof(v -> (pair ->> 0)) <> 'null' AND jsonb_typeof(v -> (pair ->> 1)) <> 'null'
           AND NOT ((v -> (pair ->> 0)) < (v -> (pair ->> 1))) THEN RETURN false; END IF;
      END LOOP;
      FOR pair IN SELECT * FROM jsonb_array_elements(coalesce(s -> 'le', '[]')) LOOP
        IF jsonb_typeof(v -> (pair ->> 0)) <> 'null' AND jsonb_typeof(v -> (pair ->> 1)) <> 'null'
           AND NOT ((v -> (pair ->> 0)) <= (v -> (pair ->> 1))) THEN RETURN false; END IF;
      END LOOP;
      RETURN true;
    WHEN 'list' THEN
      IF jsonb_typeof(v) <> 'array' OR (jsonb_array_length(v) BETWEEN (s ->> 'min')::int AND (s ->> 'max')::int) IS NOT TRUE THEN RETURN false; END IF;
      prev := NULL;
      FOR e IN SELECT * FROM jsonb_array_elements(v) LOOP
        IF public.setting_value_ok(s -> 'of', e) IS NOT TRUE THEN RETURN false; END IF;
        IF coalesce((s ->> 'desc')::boolean, false) THEN
          IF prev IS NOT NULL AND NOT (e #>> '{}')::numeric < prev THEN RETURN false; END IF;
          prev := (e #>> '{}')::numeric;
        END IF;
      END LOOP;
      IF coalesce((s ->> 'unique')::boolean, false)
         AND (SELECT count(DISTINCT x) FROM jsonb_array_elements(v) x) <> jsonb_array_length(v) THEN RETURN false; END IF;
      RETURN true;
    WHEN 'opt' THEN
      RETURN jsonb_typeof(v) = 'null' OR public.setting_value_ok(s -> 'of', v);
    WHEN 'oneof' THEN
      IF jsonb_typeof(v) <> 'object' THEN RETURN false; END IF;
      SELECT o INTO c FROM jsonb_array_elements(s -> 'of') o WHERE o -> 'k' = v -> 'k';
      IF c IS NULL THEN RETURN false; END IF;
      IF c -> 's' IS NULL THEN
        RETURN (SELECT count(*) FROM jsonb_object_keys(v)) = 1;
      END IF;
      RETURN (SELECT count(*) FROM jsonb_object_keys(v)) = 2 AND v ? 'v' AND public.setting_value_ok(c -> 's', v -> 'v');
    ELSE
      RETURN false;
  END CASE;
END
$$;--> statement-breakpoint
-- Every seeded default fits its own spec (a registry error fails the migration).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.setting_defs WHERE kind = 'value' AND public.setting_value_ok(spec, default_value) IS NOT TRUE) THEN
    RAISE EXCEPTION 'a setting default does not fit its bounds: %',
      (SELECT string_agg(key, ', ') FROM public.setting_defs WHERE kind = 'value' AND public.setting_value_ok(spec, default_value) IS NOT TRUE);
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE public.setting_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Values in force are configuration every staff member's screens use (no personal data):
-- active and superseded versions of the tenant, branch rows within the acting role's
-- branches. Proposals (draft, rejected, cancelled, with their reasons) only to the roles
-- that change, draft or approve that setting (setting_role_sees).
CREATE FUNCTION public.setting_role_sees(p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.setting_defs d
     WHERE d.key = p_key
       AND (public.app_acting_role() = ANY (d.changers)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(d.drafts) x
                        WHERE x ->> 'by' = public.app_acting_role() OR x ->> 'approver' = public.app_acting_role())))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.setting_role_sees(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.setting_role_sees(text) TO clinic_app;--> statement-breakpoint
CREATE POLICY setting_versions_read ON public.setting_versions FOR SELECT TO clinic_app
  USING (tenant_id = public.app_tenant_id()
         AND (branch_id IS NULL OR public.app_branch_allowed(branch_id))
         AND (state IN ('active','superseded') OR public.setting_role_sees(key)));--> statement-breakpoint
GRANT SELECT ON public.setting_versions TO clinic_app;--> statement-breakpoint

-- One waiting draft per setting and branch; one version per approval.
CREATE UNIQUE INDEX setting_versions_one_draft ON public.setting_versions
  (tenant_id, key, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE state = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX setting_versions_approval ON public.setting_versions (tenant_id, approval_id) WHERE approval_id IS NOT NULL;--> statement-breakpoint

-- Approval types of drafts (07: Admin Pusat drafts money rows for the owner; the
-- pharmacist proposes SET-48 for the facility head). Decided through setting_draft_decide.
INSERT INTO public.approval_types (key, label, requester_roles, approver_roles, owner_self) VALUES
  ('setting_change_owner', 'Perubahan pengaturan', '{admin_pusat}', '{owner}', false),
  ('setting_change_fh', 'Perubahan pengaturan klinis', '{pharmacist}', '{facility_head}', false);--> statement-breakpoint

-- setting_defs is a platform table the app cannot read; the default comes through this
-- definer read of the one column.
CREATE FUNCTION public.setting_default(p_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT default_value FROM public.setting_defs WHERE key = p_key
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.setting_default(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.setting_default(text) TO clinic_app;--> statement-breakpoint

-- The value in force for (key, branch) at time p_at in the bound tenant: the branch's
-- newest active version, else the tenant's (branch-scoped rows fall back to the tenant
-- value), else the default. Transactions call it and store the result (snapshot, DATA-6).
CREATE FUNCTION public.setting_value_at(p_key text, p_branch uuid DEFAULT NULL, p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    (SELECT v.value FROM public.setting_versions v
      WHERE v.tenant_id = public.app_tenant_id() AND v.key = p_key AND v.state = 'active'
        AND p_branch IS NOT NULL AND v.branch_id = p_branch AND v.effective_from <= p_at
      ORDER BY v.effective_from DESC, v.id DESC LIMIT 1),
    (SELECT v.value FROM public.setting_versions v
      WHERE v.tenant_id = public.app_tenant_id() AND v.key = p_key AND v.state = 'active'
        AND v.branch_id IS NULL AND v.effective_from <= p_at
      ORDER BY v.effective_from DESC, v.id DESC LIMIT 1),
    public.setting_default(p_key))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.setting_value_at(text, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.setting_value_at(text, uuid, timestamptz) TO clinic_app;--> statement-breakpoint

-- Write one version (internal; callers have checked who may write). Checks scope, branch,
-- bounds, reason and effective time; snapshots the actor's name; audits; emits
-- SettingChanged for an active version.
-- The effective time of a change taken after the per-setting lock: the requested time,
-- never before now (clock_timestamp, not the transaction start), and never before the
-- newest version already in force, so the last decision wins.
-- Requires READ COMMITTED (the app's isolation, DEC-016): the floor reads versions
-- committed while this transaction waited on the per-setting lock.
CREATE FUNCTION public.setting_effective(p_tenant uuid, p_key text, p_branch uuid, p_requested timestamptz) RETURNS timestamptz
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT greatest(coalesce(p_requested, clock_timestamp()), clock_timestamp(),
                  coalesce((SELECT max(v.effective_from) + interval '1 microsecond' FROM public.setting_versions v
                             WHERE v.tenant_id = p_tenant AND v.key = p_key AND v.branch_id IS NOT DISTINCT FROM p_branch
                               AND v.state = 'active' AND v.effective_from <= clock_timestamp()), '-infinity'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.setting_effective(uuid, text, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- A version that takes effect at `p_at` supersedes active versions of the same setting and
-- branch scheduled at or after it (a restore or change now overrides an earlier-scheduled
-- future value; the history keeps them, marked superseded).
CREATE FUNCTION public.setting_supersede(p_tenant uuid, p_key text, p_branch uuid, p_at timestamptz, p_keep uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  UPDATE public.setting_versions SET state = 'superseded', decided_at = clock_timestamp()
   WHERE tenant_id = p_tenant AND key = p_key AND branch_id IS NOT DISTINCT FROM p_branch
     AND state = 'active' AND effective_from >= p_at AND id <> p_keep
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.setting_supersede(uuid, text, uuid, timestamptz, uuid) FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.setting_write(p_tenant uuid, p_staff uuid, p_role text, p_key text, p_branch uuid, p_value jsonb,
                                     p_effective timestamptz, p_reason text, p_state text, p_restored boolean,
                                     p_id uuid DEFAULT NULL, p_approval uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  d public.setting_defs;
  v_name text;
  v_id uuid;
BEGIN
  SELECT * INTO STRICT d FROM public.setting_defs WHERE key = p_key;
  IF d.kind <> 'value' THEN
    RAISE EXCEPTION 'ERR_SETTING_NOT_ALLOWED: this setting is edited on its own page' USING ERRCODE = 'P0422';
  END IF;
  -- Tenant settings have one value; branch settings have a tenant value (every branch
  -- without its own) and per-branch values.
  IF d.scope = 'tenant' AND p_branch IS NOT NULL THEN
    RAISE EXCEPTION 'ERR_SETTING_NOT_ALLOWED: % is a tenant setting', d.key USING ERRCODE = 'P0422';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = p_tenant AND b.id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  IF public.setting_value_ok(d.spec, p_value) IS NOT TRUE THEN
    RAISE EXCEPTION 'ERR_SETTING_OUT_OF_BOUNDS: value outside the bounds of %', d.key USING ERRCODE = 'P0422';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a change needs a reason (3–500 characters)' USING ERRCODE = '22023';
  END IF;
  -- NULL = now; a requested time may lag the database clock by up to a minute.
  IF p_effective < clock_timestamp() - interval '1 minute' OR p_effective > clock_timestamp() + interval '366 days' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: effective from now up to one year ahead' USING ERRCODE = '22023';
  END IF;
  SELECT s.display_name INTO STRICT v_name FROM public.staff s WHERE s.tenant_id = p_tenant AND s.id = p_staff;
  INSERT INTO public.setting_versions (id, tenant_id, branch_id, key, value, restored_default, effective_from, state,
                                       changed_by, changed_as, changed_name, reason, approval_id)
  VALUES (coalesce(p_id, public.uuid_generate_v7()), p_tenant, p_branch, d.key, p_value, CASE WHEN p_restored THEN 'yes' ELSE 'no' END,
          public.setting_effective(p_tenant, d.key, p_branch, p_effective), p_state, p_staff, p_role, v_name, btrim(p_reason), p_approval)
  RETURNING id INTO v_id;
  IF p_state = 'active' THEN
    PERFORM public.setting_supersede(p_tenant, d.key, p_branch, (SELECT effective_from FROM public.setting_versions WHERE tenant_id = p_tenant AND id = v_id), v_id);
  END IF;
  PERFORM public.audit_append('settings_change', 'setting_version', v_id, 'success',
          CASE WHEN p_state = 'draft' THEN 'setting_drafted' WHEN p_restored THEN 'setting_restored' ELSE 'setting_changed' END);
  IF p_state = 'active' THEN
    INSERT INTO public.domain_events (branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (p_branch, 'SettingChanged', 'setting_version', v_id,
            jsonb_build_object('setting', lower(translate(d.key, '-.', '__'))));
  END IF;
  RETURN v_id;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.setting_write(uuid, uuid, text, text, uuid, jsonb, timestamptz, text, text, boolean, uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- Change a setting directly (a changer role) or propose it (a drafter role): the proposal
-- is a draft version plus an approval for the approver; p_restore = true writes the
-- researched default ("Kembalikan ke default"). Returns {state, version_id, approval_id?}.
CREATE FUNCTION public.setting_set(p_key text, p_branch uuid, p_value jsonb, p_effective timestamptz, p_reason text, p_restore boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  d public.setting_defs;
  v_approver text;
  v_value jsonb;
  v_version uuid;
  v_approval uuid;
BEGIN
  SELECT * INTO a FROM public.approval_actor();
  SELECT * INTO d FROM public.setting_defs WHERE key = p_key;
  IF NOT FOUND THEN
    -- PR-38: a setting outside the decided list does not exist.
    RAISE EXCEPTION 'ERR_SETTING_NOT_ALLOWED: no such setting' USING ERRCODE = 'P0422';
  END IF;
  -- Branch roles act at their active branch only; tenant-wide roles at any branch. A
  -- tenant setting that names a branch role (SET-28/29/31/47 facility head, SET-48
  -- pharmacist) is changed by it tenant-wide; a branch setting's tenant value
  -- (branch null) is for tenant-wide roles only.
  IF p_branch IS NOT NULL AND a.branch_id IS NOT NULL AND p_branch <> a.branch_id THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: outside the acting role''s branch' USING ERRCODE = '42501';
  END IF;
  IF p_branch IS NULL AND a.branch_id IS NOT NULL AND d.scope = 'branch' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: a branch role changes its branch value' USING ERRCODE = '42501';
  END IF;
  v_value := CASE WHEN coalesce(p_restore, false) THEN d.default_value ELSE p_value END;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = a.tenant_id AND b.id = p_branch) THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: branch not found' USING ERRCODE = 'P0002';
  END IF;
  -- Changes of one setting in one tenant are serialized (versions ordered by effect).
  PERFORM pg_advisory_xact_lock(hashtextextended('setting:' || a.tenant_id::text || ':' || d.key, 0));
  IF a.role = ANY (d.changers) THEN
    v_version := public.setting_write(a.tenant_id, a.staff_id, a.role, d.key, p_branch, v_value, p_effective, p_reason, 'active', coalesce(p_restore, false));
    RETURN jsonb_build_object('state', 'active', 'version_id', v_version);
  END IF;
  SELECT x ->> 'approver' INTO v_approver FROM jsonb_array_elements(d.drafts) x WHERE x ->> 'by' = a.role;
  IF v_approver IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN: this role does not change this setting' USING ERRCODE = '42501';
  END IF;
  -- One waiting draft per setting and branch.
  IF EXISTS (SELECT 1 FROM public.setting_versions v WHERE v.tenant_id = a.tenant_id AND v.key = d.key
               AND v.branch_id IS NOT DISTINCT FROM p_branch AND v.state = 'draft') THEN
    RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: a draft for this setting is already waiting' USING ERRCODE = '23505';
  END IF;
  -- The approval names the draft version (its id is chosen first) and the draft names the
  -- approval: both are written in this transaction.
  v_version := public.uuid_generate_v7();
  v_approval := public.approval_request(CASE v_approver WHEN 'owner' THEN 'setting_change_owner' WHEN 'facility_head' THEN 'setting_change_fh' END,
                                        'setting_version', v_version, btrim(p_reason), p_branch, NULL);
  PERFORM public.setting_write(a.tenant_id, a.staff_id, a.role, d.key, p_branch, v_value, p_effective, p_reason, 'draft',
                               coalesce(p_restore, false), v_version, v_approval);
  RETURN jsonb_build_object('state', 'draft', 'version_id', v_version, 'approval_id', v_approval);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.setting_set(text, uuid, jsonb, timestamptz, text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.setting_set(text, uuid, jsonb, timestamptz, text, boolean) TO clinic_app;--> statement-breakpoint

-- A setting_change_* approval and its draft move together, whichever path decides it
-- (Persetujuan through setting_draft_decide, the plain approval functions, or a later
-- engine expiry): when the approval leaves `pending`, its draft becomes active (approved;
-- from its requested time, or now if that has passed, superseding later scheduled
-- versions), rejected, or cancelled, in the same transaction.
CREATE FUNCTION public.setting_draft_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  ver public.setting_versions;
  v_at timestamptz;
BEGIN
  IF NEW.type NOT IN ('setting_change_owner','setting_change_fh') OR OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO ver FROM public.setting_versions WHERE tenant_id = NEW.tenant_id AND approval_id = NEW.id AND state = 'draft' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('setting:' || NEW.tenant_id::text || ':' || ver.key, 0));
  IF NEW.state = 'approved' THEN
    IF public.setting_value_ok((SELECT spec FROM public.setting_defs WHERE key = ver.key), ver.value) IS NOT TRUE THEN
      RAISE EXCEPTION 'ERR_SETTING_OUT_OF_BOUNDS: value outside the bounds of %', ver.key USING ERRCODE = 'P0422';
    END IF;
    v_at := public.setting_effective(NEW.tenant_id, ver.key, ver.branch_id, ver.effective_from);
    UPDATE public.setting_versions SET state = 'active', effective_from = v_at, decided_at = clock_timestamp()
     WHERE tenant_id = NEW.tenant_id AND id = ver.id;
    PERFORM public.setting_supersede(NEW.tenant_id, ver.key, ver.branch_id, v_at, ver.id);
    INSERT INTO public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, payload)
    VALUES (NEW.tenant_id, ver.branch_id, 'SettingChanged', 'setting_version', ver.id, jsonb_build_object('setting', lower(translate(ver.key, '-.', '__'))));
  ELSIF NEW.state IN ('rejected','cancelled') THEN
    UPDATE public.setting_versions SET state = NEW.state, decided_at = clock_timestamp()
     WHERE tenant_id = NEW.tenant_id AND id = ver.id;
  ELSE
    RETURN NULL; -- a future approval state is handled when it is introduced
  END IF;
  -- The version's own audit row (the approval's row records the decision); written when a
  -- staff context is bound (every current path decides as a person).
  IF public.app_staff_id() IS NOT NULL THEN
    PERFORM public.audit_append('settings_change', 'setting_version', ver.id, 'success',
            CASE NEW.state WHEN 'approved' THEN 'setting_draft_applied' WHEN 'rejected' THEN 'setting_draft_rejected' ELSE 'setting_draft_cancelled' END);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER approvals_setting_draft_sync AFTER UPDATE OF state ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.setting_draft_sync();--> statement-breakpoint
ALTER TABLE public.approvals ENABLE ALWAYS TRIGGER approvals_setting_draft_sync;--> statement-breakpoint

-- Decide a draft from Persetujuan: approval_decide checks approver ≠ requester and role,
-- audits and emits; the trigger applies or rejects the draft in the same transaction.
CREATE FUNCTION public.setting_draft_decide(p_approval uuid, p_approve boolean, p_reason text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_key text;
BEGIN
  -- Same lock order as the plain path (approval row, then the draft and the per-setting
  -- lock in setting_draft_sync), so concurrent deciders wait instead of deadlocking.
  PERFORM 1 FROM public.approvals WHERE tenant_id = v_tenant AND id = p_approval FOR UPDATE;
  SELECT key INTO v_key FROM public.setting_versions WHERE tenant_id = v_tenant AND approval_id = p_approval AND state = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: draft not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.approval_decide(p_approval, p_approve, p_reason);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.setting_draft_decide(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.setting_draft_decide(uuid, boolean, text) TO clinic_app;--> statement-breakpoint

-- The requester withdraws a waiting draft (only a settings draft; the trigger cancels it).
CREATE FUNCTION public.setting_draft_cancel(p_approval uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_key text;
BEGIN
  PERFORM 1 FROM public.approvals WHERE tenant_id = v_tenant AND id = p_approval FOR UPDATE;
  SELECT key INTO v_key FROM public.setting_versions WHERE tenant_id = v_tenant AND approval_id = p_approval AND state = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_NOT_FOUND: draft not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.approval_cancel(p_approval);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.setting_draft_cancel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.setting_draft_cancel(uuid) TO clinic_app;--> statement-breakpoint

-- History is append-only: a version's content never changes; a draft only moves to
-- active/rejected/cancelled once (setting_draft_decide / _cancel); nothing is deleted.
CREATE FUNCTION public.setting_versions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'setting versions are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state NOT IN ('active','draft') OR NEW.decided_at IS NOT NULL OR (NEW.state = 'draft') <> (NEW.approval_id IS NOT NULL) THEN
      RAISE EXCEPTION 'a version starts active, or draft with its approval' USING ERRCODE = '42501';
    END IF;
    IF NEW.state = 'draft' AND NOT EXISTS (
         SELECT 1 FROM public.approvals ap WHERE ap.tenant_id = NEW.tenant_id AND ap.id = NEW.approval_id AND ap.state = 'pending'
            AND ap.type IN ('setting_change_owner','setting_change_fh') AND ap.subject_kind = 'setting_version' AND ap.subject_id = NEW.id) THEN
      RAISE EXCEPTION 'a draft names its own pending settings approval' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.branch_id, NEW.key, NEW.value, NEW.restored_default, NEW.changed_by, NEW.changed_as, NEW.changed_name,
      NEW.reason, NEW.created_at, NEW.approval_id)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.branch_id, OLD.key, OLD.value, OLD.restored_default, OLD.changed_by, OLD.changed_as,
      OLD.changed_name, OLD.reason, OLD.created_at, OLD.approval_id) THEN
    RAISE EXCEPTION 'a setting version is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.decided_at IS NULL THEN
    RAISE EXCEPTION 'a state change records its time' USING ERRCODE = '42501';
  END IF;
  -- draft → active (effective time only forward), rejected or cancelled (time unchanged);
  -- active → superseded (time unchanged). Nothing else.
  IF OLD.state = 'draft' AND NEW.state = 'active' AND NEW.effective_from >= OLD.effective_from THEN
    RETURN NEW;
  END IF;
  IF OLD.state = 'draft' AND NEW.state IN ('rejected','cancelled') AND NEW.effective_from = OLD.effective_from THEN
    RETURN NEW;
  END IF;
  IF OLD.state = 'active' AND OLD.decided_at IS NULL AND NEW.state = 'superseded' AND NEW.effective_from = OLD.effective_from THEN
    RETURN NEW;
  END IF;
  IF OLD.state = 'active' AND OLD.approval_id IS NOT NULL AND NEW.state = 'superseded' AND NEW.effective_from = OLD.effective_from THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'only a waiting draft is decided, once; an active version is only superseded' USING ERRCODE = '42501';
END
$$;--> statement-breakpoint
CREATE TRIGGER setting_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.setting_versions
  FOR EACH ROW EXECUTE FUNCTION public.setting_versions_guard();--> statement-breakpoint
ALTER TABLE public.setting_versions ENABLE ALWAYS TRIGGER setting_versions_guard;--> statement-breakpoint
CREATE TRIGGER setting_versions_no_truncate BEFORE TRUNCATE ON public.setting_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.domain_events_immutable();--> statement-breakpoint

-- Every draft route of the registry has its approval type with matching roles.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.setting_defs d CROSS JOIN LATERAL jsonb_array_elements(d.drafts) x
     WHERE NOT EXISTS (SELECT 1 FROM public.approval_types t
                        WHERE t.key = CASE x ->> 'approver' WHEN 'owner' THEN 'setting_change_owner' WHEN 'facility_head' THEN 'setting_change_fh' END
                          AND x ->> 'by' = ANY (t.requester_roles) AND x ->> 'approver' = ANY (t.approver_roles))) THEN
    RAISE EXCEPTION 'a setting draft route has no matching approval type';
  END IF;
END
$$;--> statement-breakpoint

INSERT INTO public.scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics) VALUES
  ('public.setting_defs', 'platform', 'settings', '{}', 'migrations (registry in src/modules/settings/registry.ts)', 'none'),
  ('public.setting_versions', 'tenant-shared', 'settings', '{*}', 'setting functions (src/modules/settings)', 'branch value of branch-scoped settings');
