"use client";
// Kamus KPI (UX-59, Scenario PR-95): a report's "Definisi Kn" link is a CLIENT navigation to /laporan/kamus-kpi#kn. The dictionary body streams inside <Suspense> (the role gate reads the
// request), and Next's router drops a hash scroll whose target does not exist yet at the first commit ("A missing hash target is still a handled scroll intent", layout-router) — so the entry
// stayed 3.8 screens below the fold in the browser run. Once the body is mounted the target exists: scroll to it. Renders nothing; reads only the URL's own hash.
import { useEffect } from "react";

export function ScrollToHash() {
  useEffect(() => {
    let id = "";
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; } // a malformed escape is no anchor
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return null;
}
