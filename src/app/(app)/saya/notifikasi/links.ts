// Notifikasi drill-down (HYG-NAV-1): where a notification's subject opens, for subjects that already have a page. Unknown subjects get no
// link (the row still reads; never a dead link). Pure; tested in tests/ui/hyg-nav-1.test.ts.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BY_KIND: Partial<Record<string, (id: string) => string>> = {
  approval: (id) => `/persetujuan/${id}`,
  clinical_request: (id) => `/permintaan/${id}`,
  complaint_task: (id) => `/keluhan/${id}`,
  clinical_incident: (id) => `/keluhan/insiden/${id}`,
  staff_credential: () => "/staf?segmen=kredensial",
  staff_invitation: () => "/staf?segmen=undangan",
  device_schedule: () => "/logbook",
  waba_account: () => "/pesan/nomor",
  waitlist_entry: () => "/jadwal",
  patient: (id) => `/pasien/${id}`,
};
export function subjectHref(kind: string, id: string): string | null {
  const f = BY_KIND[kind];
  return f && UUID.test(id) ? f(id) : null;
}
