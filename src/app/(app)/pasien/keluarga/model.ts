// Keluarga / Wali, pure (HYG-NAV-2): group guardian links by guardian (one guardian, several children), and filter by a typed name / MRN.
// Tested in tests/ui/hyg-nav-2.test.ts.
export type Link = { patientId: string; patientName: string; patientMrn: string; guardianName: string; relation: string; phone: string | null; guardianPatientId: string | null };
export type Household = { key: string; guardianName: string; phone: string | null; guardianPatientId: string | null; children: Link[] };

// Server side only (data.ts): the grouping identity, computed BEFORE the phone is masked (review r1 P2). A guardian is the same person
// when they are the same patient (guardianPatientId), or have the same normalised name AND the same full phone. Without either (no phone,
// no patient id) each link stays its own household — two "Ibu Sari" without a phone are never merged. The key that leaves is opaque.
export type RawLink = Omit<Link, "phone"> & { phone: string | null; id: string };
export const normPhone = (p: string | null) => {
  const d = (p ?? "").replace(/[\s().-]/g, "");
  const m = /^(?:\+?62|0)(8\d{7,12})$/.exec(d);
  return m ? `+62${m[1]}` : d || null;
};
export function groupKey(l: RawLink): string {
  if (l.guardianPatientId) return `p:${l.guardianPatientId}`;
  const phone = normPhone(l.phone);
  return phone ? `n:${l.guardianName.trim().toLowerCase().replace(/\s+/g, " ")}|${phone}` : `g:${l.id}`;
}
export const maskPhone = (p: string | null) => { const n = normPhone(p); return n ? `${n.slice(0, 3)}${"•".repeat(Math.max(n.length - 7, 0))}${n.slice(-4)}` : null; };
export type KeyedLink = Link & { group: string };
export function households(links: readonly KeyedLink[]): Household[] {
  const m = new Map<string, Household>();
  for (const l of links) {
    const k = l.group;
    const h = m.get(k) ?? { key: k, guardianName: l.guardianName, phone: l.phone, guardianPatientId: l.guardianPatientId, children: [] };
    if (!h.children.some((c) => c.patientId === l.patientId)) h.children.push(l);
    m.set(k, h);
  }
  return [...m.values()].sort((a, b) => b.children.length - a.children.length || a.guardianName.localeCompare(b.guardianName, "id"));
}
export function filterHouseholds(hs: readonly Household[], q: string): Household[] {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [...hs];
  return hs.filter((h) => h.guardianName.toLowerCase().includes(t) || h.children.some((c) => c.patientName.toLowerCase().includes(t) || c.patientMrn.toLowerCase().includes(t)));
}
