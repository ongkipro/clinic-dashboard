"use server";
// Notifikasi action (PR-54; HYG-NAV-1): Tandai Selesai — acknowledge one notification for everyone it was raised to (notification_ack:
// the caller must be able to see it; once only). Refuses a form rendered in another context first (HYG-009 B2-1).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { ack } from "../../../../modules/notifications/notifications";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export type AckState = { error?: string; n?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function ackAction(p: AckState, f: FormData): Promise<AckState> {
  const n = (p.n ?? 0) + 1;
  const id = typeof f.get("id") === "string" ? (f.get("id") as string) : "";
  if (!UUID.test(id)) return { error: "Notifikasi tidak dikenali. Muat ulang halaman.", n };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: "Peran ini tidak dapat melakukan aksi ini.", n };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT, n };
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => ack(db, id));
  } catch (e) {
    if (e instanceof CommandError) return { error: "Notifikasi tidak ditemukan atau sudah ditandai. Muat ulang halaman.", n };
    console.error("notifikasi: ack failed", { error: e instanceof Error ? e.name : "unknown" });
    return { error: "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.", n };
  }
  revalidatePath("/saya/notifikasi");
  return { n };
}
