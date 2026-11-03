"use server";
// Saya › Ganti Peran: the assigned person confirms or declines an Owner grant (DEC-031 D7).
// The request id comes from the form; the database accepts it only from the person the
// grant names (role_owner_confirm), in the request's active context.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { appPool, requestContext } from "../context/store";
import { answerOwnerGrant } from "./roles";

export type OwnerGrantState = { error?: string; ok?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function answerOwnerGrantAction(_p: OwnerGrantState, f: FormData): Promise<OwnerGrantState> {
  const id = f.get("id");
  const answer = f.get("answer");
  if (typeof id !== "string" || !UUID.test(id) || (answer !== "terima" && answer !== "tolak")) return { error: "Permintaan tidak valid." };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: "Anda tidak punya akses untuk tindakan ini." };
  try {
    const r = await withTenantContext(await appPool(), rc.active.context, (db) => answerOwnerGrant(db, id, answer === "terima"));
    revalidatePath("/saya/peran");
    if (r === "lapsed") return { error: "Penunjukan ini sudah tidak berlaku. Minta penunjukan baru ke Owner." };
    return { ok: r === "approved" ? "Peran Owner aktif. Pilih Owner di daftar peran untuk memakainya." : "Penunjukan Owner ditolak." };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P0002") return { error: "Penunjukan ini sudah tidak menunggu jawaban Anda." };
    throw e;
  }
}
