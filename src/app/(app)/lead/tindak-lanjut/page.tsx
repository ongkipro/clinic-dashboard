// Tindak Lanjut (19:165, UX-18 ▸ Tindak Lanjut; HYG-NAV-1): the CS and BC tab. The follow-up queue is the Tindak Lanjut segment of
// Lead (T-092/T-093); this route opens it. No data here.
import { redirect } from "next/navigation";
import { TINDAK_LANJUT_HREF } from "./target";

export default function TindakLanjutPage() {
  redirect(TINDAK_LANJUT_HREF);
}
