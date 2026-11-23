"use client";
// Reapplies the stored "Kurangi transparansi" device preference on <html> after every full load of a clinic page (HYG-NAV-1 review r1 P2).
// Mounted once in the clinic layout; renders nothing. localStorage only (no server state, no analytics).
import { useEffect } from "react";
import { applyStoredReduce } from "./prefs";

export function ApplyTampilan() {
  useEffect(() => {
    applyStoredReduce(localStorage, document.documentElement);
  }, []);
  return null;
}
