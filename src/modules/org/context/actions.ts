"use server";
// Saya › Ganti Klinik / Ganti Peran / Ganti Cabang (PR-84). The session and the account
// come from the request; the requested clinic, role or branch is re-validated against
// the account's memberships, recorded (org_actions) and then stored for this device.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ContextSwitchError, serializeSelection, STALE_CONTEXT, staleContext, type SwitchRequest, switchContext } from "./context";
import { appPool, CONTEXT_COOKIE, requestContext } from "./store";

export type SwitchState = { error?: string };

export async function switchAction(_prev: SwitchState, form: FormData): Promise<SwitchState> {
  const kind = form.get("kind");
  const value = form.get("value");
  if (typeof value !== "string" || value.length > 64) return { error: "Pilihan tidak valid." };
  let req: SwitchRequest;
  if (kind === "clinic") req = { kind, tenantId: value };
  else if (kind === "role") req = { kind, role: value };
  else if (kind === "branch") req = { kind, branchId: value === "semua" ? null : value };
  else return { error: "Pilihan tidak valid." };

  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: "Akun Anda belum punya peran atau cabang aktif." };
  if (staleContext(form, rc.active.context)) return { error: STALE_CONTEXT };
  let next;
  try {
    next = await switchContext(await appPool(), rc.accountId, rc.selection, req, rc.sessionId);
  } catch (e) {
    if (e instanceof ContextSwitchError) return { error: "Pilihan ini tidak tersedia untuk akun Anda." };
    throw e;
  }
  (await cookies()).set(CONTEXT_COOKIE, serializeSelection(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.APP_URL?.startsWith("https://") ?? true,
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  redirect("/saya");
}
