// Recorded Meta Cloud API webhook shapes (Graph v21.0) and a recorded template list for the mock adapter (T-090). Synthetic: no real number,
// person or message. The builders return the exact JSON Meta posts, so the intake parses what production would receive.
import type { RemoteTemplate } from "./port";

export const RECORDED_TEMPLATES: RemoteTemplate[] = [
  { name: "pengingat_janji", language: "id", category: "utility", status: "approved", body: "Halo {{1}}, mengingatkan janji Anda pada {{2}}.", paramCount: 2 },
  { name: "konfirmasi_booking", language: "id", category: "utility", status: "approved", body: "Booking Anda pada {{1}} sudah kami terima.", paramCount: 1 },
  { name: "promo_bulan_ini", language: "id", category: "marketing", status: "approved", body: "Ada penawaran baru bulan ini di {{1}}.", paramCount: 1 },
  { name: "sapaan_baru", language: "id", category: "utility", status: "pending", body: "Terima kasih telah menghubungi kami.", paramCount: 0 },
];

type Meta = { wabaId: string; phoneNumberId: string; displayPhone?: string };
const envelope = (m: Meta, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: m.wabaId, changes: [{ field: "messages", value: { messaging_product: "whatsapp",
    metadata: { display_phone_number: m.displayPhone ?? "6281100000000", phone_number_id: m.phoneNumberId }, ...value } }] }],
});

// An inbound text from a contact (wa_id digits), at a unix second.
export function inboundText(m: Meta, o: { id: string; from: string; name?: string; text: string; at: number }) {
  return envelope(m, {
    contacts: [{ profile: { name: o.name ?? "Kontak Sintetis" }, wa_id: o.from }],
    messages: [{ from: o.from, id: o.id, timestamp: String(o.at), type: "text", text: { body: o.text } }],
  });
}
// An inbound image (Meta's opaque media id; the temporary URL is fetched later and never stored, TD-23).
export function inboundImage(m: Meta, o: { id: string; from: string; mediaId: string; caption?: string; at: number }) {
  return envelope(m, {
    contacts: [{ profile: { name: "Kontak Sintetis" }, wa_id: o.from }],
    messages: [{ from: o.from, id: o.id, timestamp: String(o.at), type: "image",
      image: { id: o.mediaId, mime_type: "image/jpeg", sha256: "0".repeat(64), ...(o.caption ? { caption: o.caption } : {}) } }],
  });
}
// A status for an outbound message.
export function statusEvent(m: Meta, o: { id: string; status: "sent" | "delivered" | "read" | "failed"; to: string; at: number }) {
  return envelope(m, { statuses: [{ id: o.id, status: o.status, timestamp: String(o.at), recipient_id: o.to }] });
}
// A Coexistence echo: a reply sent from the WhatsApp Business app (TD-24).
export function echoText(m: Meta, o: { id: string; to: string; text: string; at: number }) {
  return envelope(m, {
    message_echoes: [{ from: m.displayPhone ?? "6281100000000", to: o.to, id: o.id, timestamp: String(o.at), type: "text", text: { body: o.text } }],
  });
}
