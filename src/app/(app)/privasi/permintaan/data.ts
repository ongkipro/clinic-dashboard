// UX-30 ▸ Permintaan data loaders (PR-50; T-121): privacy officers only (Owner, or Admin Pusat with
// active data_protection duty); the database decides via privacy_actor('data_request').
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { type RenderedContext, renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import {
  type DsrDetail,
  type DsrLinkOptions,
  type DsrListResult,
  getDsr,
  getDsrLinkOptions,
  listDsrs,
} from "../../../../modules/privacy/requests";

export type DsrListData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "ok"; ctx: RenderedContext; data: DsrListResult };

export type DsrDetailData =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "ok"; ctx: RenderedContext; detail: DsrDetail; linkOptions: DsrLinkOptions };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadDsrList(): Promise<DsrListData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !["owner", "admin_pusat"].includes(rc.active.context.actingRole)) {
    return { kind: "forbidden" };
  }
  const c = rc.active.context;
  try {
    const data = await withTenantContext(await appPool(), c, (db) => listDsrs(db, { state: "all", right: null }));
    return { kind: "ok", ctx: renderedContext(c), data };
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_FORBIDDEN" || e.code === "ERR_TENANT_SUSPENDED")) {
      return { kind: "forbidden" };
    }
    throw e;
  }
}

export async function loadDsrDetail(id: string): Promise<DsrDetailData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !["owner", "admin_pusat"].includes(rc.active.context.actingRole)) {
    return { kind: "forbidden" };
  }
  if (!UUID.test(id)) return { kind: "not_found" };
  const c = rc.active.context;
  try {
    const { detail, linkOptions } = await withTenantContext(await appPool(), c, async (db) => {
      const detail = await getDsr(db, id);
      const linkOptions = await getDsrLinkOptions(db, id);
      return { detail, linkOptions };
    });
    return { kind: "ok", ctx: renderedContext(c), detail, linkOptions };
  } catch (e) {
    if (e instanceof CommandError) {
      if (e.code === "ERR_FORBIDDEN" || e.code === "ERR_TENANT_SUSPENDED") return { kind: "forbidden" };
      if (e.code === "ERR_NOT_FOUND") return { kind: "not_found" };
    }
    throw e;
  }
}
