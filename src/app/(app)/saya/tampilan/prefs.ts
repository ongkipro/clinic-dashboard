// Tampilan preferences (DESIGN.md Materials: "Saya › Tampilan offers 'Kurangi transparansi' (sets reduce-transparency on <html>)";
// HYG-NAV-1). Device-local (no server state, no analytics), per browser. Pure helpers; the toggle lives in toggle.tsx.
export const REDUCE_KEY = "tampilan.kurangi-transparansi";
export const REDUCE_CLASS = "reduce-transparency";

export type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
export const readReduce = (s: Store) => s.getItem(REDUCE_KEY) === "1";
export function writeReduce(s: Store, root: { classList: { toggle(c: string, on: boolean): unknown } }, on: boolean) {
  if (on) s.setItem(REDUCE_KEY, "1");
  else s.removeItem(REDUCE_KEY);
  root.classList.toggle(REDUCE_CLASS, on);
}
// On every clinic page load: the stored device value onto <html> (the class is not server-rendered; review r1 P2).
export const applyStoredReduce = (s: Store, root: { classList: { toggle(c: string, on: boolean): unknown } }) => root.classList.toggle(REDUCE_CLASS, readReduce(s));
