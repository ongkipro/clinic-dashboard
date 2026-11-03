"use server";
// Setujui / Tolak from the Persetujuan detail (UX-26). Runs in the request's active
// context; approval_decide (T-011) refuses the requester, other roles, other tenants and
// already decided approvals.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { decideApproval } from "../../../modules/approvals/approvals";
import { SETTING_DRAFT_TYPES } from "../../../modules/approvals/inbox";
import { decideDraft } from "../../../modules/settings/settings";
import { appPool, requestContext } from "../../../modules/org/context/store";

export type DecideState = { error?: string; ok?: string; reason?: string };

const MESSAGES: Record<string, string> = {
  ERR_APPROVER_IS_REQUESTER: "Anda pengaju — tidak dapat menyetujui.",
  ERR_FORBIDDEN: "Anda tidak punya akses untuk keputusan ini.",
  ERR_NOT_FOUND: "Permintaan tidak ditemukan.",
  ERR_VERSION_CONFLICT: "Permintaan ini sudah diputuskan. Muat ulang untuk melihat hasilnya.",
};
const FALLBACK = "Keputusan belum tersimpan. Coba lagi.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function decideAction(_p: DecideState, f: FormData): Promise<DecideState> {
  const id = f.get("id");
  const decision = f.get("decision");
  const reason = typeof f.get("reason") === "string" ? (f.get("reason") as string).trim() : "";
  if (typeof id !== "string" || !UUID.test(id) || (decision !== "approve" && decision !== "reject")) return { error: MESSAGES.ERR_NOT_FOUND };
  if (decision === "reject" && reason.length < 3) return { error: "Tulis alasan penolakan.", reason };
  if (reason.length > 500) return { error: "Alasan paling banyak 500 karakter.", reason };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: MESSAGES.ERR_FORBIDDEN, reason };
  try {
    await withTenantContext(await appPool(), rc.active.context, async (db) => {
      // A settings draft is decided through the settings module (the draft applies with
      // the decision); every other type through the approvals engine.
      const type = (await db.query<{ type: string }>(`select type from approvals where id = $1`, [id])).rows[0]?.type;
      const decideFn = type && SETTING_DRAFT_TYPES.has(type) ? decideDraft : decideApproval;
      await decideFn(db, id, decision === "approve", reason || undefined);
    });
  } catch (e) {
    if (e instanceof CommandError) {
      if (!MESSAGES[e.code]) console.error("persetujuan: unmapped decision error", { code: e.code });
      return { error: MESSAGES[e.code] ?? FALLBACK, reason };
    }
    // Anything else (database or connection): the outcome is unknown; the detail page
    // shows the real state after a reload.
    console.error("persetujuan: decision failed", { error: e instanceof Error ? e.message : String(e) });
    return { error: "Keputusan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.", reason };
  }
  revalidatePath("/persetujuan");
  revalidatePath(`/persetujuan/${id}`);
  return { ok: decision === "approve" ? "Disetujui." : "Ditolak." };
}
