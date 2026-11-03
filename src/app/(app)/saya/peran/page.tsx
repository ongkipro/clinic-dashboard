// Saya › Ganti Peran (PR-84, 17 Navigation, 19 §2.16).
import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingList } from "../../../../components/ui/states";
import { SwitchBody } from "../switch-page";

export const metadata: Metadata = { title: "Ganti Peran — Clinic Dashboard" };

export default function Page() {
  return (
    <main className="mx-auto grid w-full max-w-[640px] min-w-0 gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Ganti Peran</h1>
      <Suspense fallback={<LoadingList rows={3} />}>
        <SwitchBody kind="role" />
      </Suspense>
    </main>
  );
}
