// Server data for the clinic shell (NAV-3, PR-84). Every request passes the T-006 gates
// (session, TOTP enrolment, idle lock) and resolves the active context from the stored
// selection (T-030), re-validated against the account's memberships (TEN-1).
import "server-only";
import { requestContext } from "../../modules/org/context/store";
import { type ShellData, shellFromActive } from "./context";

export async function loadShell(): Promise<ShellData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked") return { kind: "blocked" };
  return { kind: "ok", context: shellFromActive(rc.active) };
}
