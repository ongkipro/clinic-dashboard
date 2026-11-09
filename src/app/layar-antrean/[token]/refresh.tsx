"use client";
// Refreshes the display every 5 seconds (server render, no client data). With SET-40 voice on, a new first
// call is spoken once: number and room only (browser speech; never a name).
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function Refresh({ voice, current }: { voice: boolean; current: string }) {
  const router = useRouter();
  const last = useRef(current);
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => {
    if (!voice || !current || current === last.current) return;
    last.current = current;
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(`Nomor ${current}`);
      u.lang = "id-ID";
      window.speechSynthesis.speak(u);
    }
  }, [voice, current]);
  return null;
}
