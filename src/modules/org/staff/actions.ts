"use server";
// Staf & Undangan and Pengguna & Akses actions (UX-3, PR-91). Each runs in the request's
// active context; the database functions decide what the acting role may do.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ROLES, type Role } from "../../../auth/policy";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { endMembership, removeRole, revokeSession, setDuty } from "../access/access";
import { appPool, requestContext } from "../context/store";
import { cancelInvite, invitationsOpen, invite } from "./staff";

export type ActionState = { error?: string; ok?: string; link?: string };

const MESSAGES: Record<string, string> = {
  ERR_FORBIDDEN: "Anda tidak punya akses untuk tindakan ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan.",
  ERR_VERSION_CONFLICT: "Data sudah diubah orang lain. Muat ulang lalu coba lagi.",
  ERR_IDEMPOTENCY_CONFLICT: "Undangan untuk email ini masih menunggu.",
};

async function inContext<T>(fn: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0]) => Promise<T>): Promise<T | ActionState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: MESSAGES.ERR_FORBIDDEN };
  try {
    return await withTenantContext(await appPool(), rc.active.context, fn);
  } catch (e) {
    if (e instanceof CommandError) return { error: MESSAGES[e.code] ?? MESSAGES.ERR_FORBIDDEN };
    throw e;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");

export async function inviteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const email = str(f, "email").trim().toLowerCase();
  const name = str(f, "name").trim();
  const roles = f.getAll("roles").filter((r): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r));
  const branchIds = f.getAll("branches").filter((b): b is string => typeof b === "string" && UUID.test(b));
  // DEC-024: closed in production until the owner decides how the link is delivered.
  if (!invitationsOpen()) return { error: "Undangan staf belum dibuka di lingkungan ini." };
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) || name.length < 2 || roles.length === 0) {
    return { error: "Isi email, nama dan minimal satu peran." };
  }
  const r = await inContext((db) => invite(db, { email, name, roles, branchIds }));
  if ("error" in r) return r as ActionState;
  revalidatePath("/staf");
  const origin = process.env.APP_URL ?? "";
  return { ok: `Undangan untuk ${name} dibuat. Kirim tautan ini ke ${email}; tautan hanya tampil sekali.`, link: `${origin}/undangan/${(r as { token: string }).token}` };
}

export async function cancelInviteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = str(f, "id");
  if (!UUID.test(id)) return { error: MESSAGES.ERR_NOT_FOUND };
  const r = await inContext((db) => cancelInvite(db, id));
  if (r && typeof r === "object" && "error" in r) return r;
  revalidatePath("/staf");
  return { ok: "Undangan dibatalkan." };
}

export async function revokeSessionAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const staffId = str(f, "staff");
  const session = str(f, "session");
  if (!UUID.test(staffId) || (session && !UUID.test(session))) return { error: MESSAGES.ERR_NOT_FOUND };
  const r = await inContext((db) => revokeSession(db, staffId, session || null));
  if (r && typeof r === "object" && "error" in r) return r;
  revalidatePath("/pengguna-akses");
  revalidatePath(`/staf/${staffId}`); // the detail lists the session as "dicabut"
  return { ok: session ? "Sesi dicabut. Perangkat itu keluar pada permintaan berikutnya." : "Semua sesi dicabut." };
}

export async function endMembershipAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const staffId = str(f, "staff");
  if (!UUID.test(staffId)) return { error: MESSAGES.ERR_NOT_FOUND };
  const r = await inContext((db) => endMembership(db, staffId));
  if (r && typeof r === "object" && "error" in r) return r;
  revalidatePath("/staf");
  return { ok: "Keanggotaan diakhiri. Semua sesinya dicabut." };
}

export async function removeRoleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const staffId = str(f, "staff");
  const role = str(f, "role");
  if (!UUID.test(staffId) || !(ROLES as readonly string[]).includes(role)) return { error: MESSAGES.ERR_NOT_FOUND };
  const r = await inContext((db) => removeRole(db, staffId, role as Role));
  if (r && typeof r === "object" && "error" in r) return r;
  revalidatePath(`/staf/${staffId}`);
  return { ok: "Peran dicabut." };
}

export async function dutyAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const staffId = str(f, "staff");
  const duty = str(f, "duty");
  const assign = str(f, "assign") === "1";
  if (!UUID.test(staffId) || (duty !== "data_protection" && duty !== "it_admin")) return { error: MESSAGES.ERR_NOT_FOUND };
  const r = await inContext((db) => setDuty(db, staffId, duty, assign));
  if (r && typeof r === "object" && "error" in r) return r;
  revalidatePath("/pengguna-akses");
  return { ok: assign ? "Tugas diberikan." : "Tugas diakhiri." };
}
