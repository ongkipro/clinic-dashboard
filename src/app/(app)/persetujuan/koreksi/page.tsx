// Koreksi Rekam Medis (19:94, UX-26 filter; HYG-NAV-1): the Records officer's landing page and tab. Late record corrections are
// approvals of type record_late_correction (T-053), decided in Persetujuan; this route opens that inbox filtered to them. No data here.
import { redirect } from "next/navigation";
import { KOREKSI_HREF } from "./target";

export default function KoreksiPage() {
  redirect(KOREKSI_HREF);
}
