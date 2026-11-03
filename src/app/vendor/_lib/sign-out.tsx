"use client";
// Keluar on the vendor host: ends the vendor session (its own auth API and cookies).
import { useRouter } from "next/navigation";
import { useState } from "react";
import s from "./console.module.css";

export function VendorSignOut() {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        className={s.signOut}
        aria-disabled={state === "busy"}
        onClick={async () => {
          if (state === "busy") return;
          setState("busy");
          const ok = await fetch("/vendor/api/auth/sign-out", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: "{}",
          }).then(
            (r) => r.ok,
            () => false,
          );
          if (!ok) return setState("failed");
          router.replace("/vendor/masuk");
        }}
      >
        {state === "busy" ? "Keluar…" : "Keluar"}
      </button>
      {state === "failed" && (
        <p role="alert" className={s.boxMuted}>
          Belum dapat keluar. Coba lagi.
        </p>
      )}
    </>
  );
}
