// Contract for a cross-tenant negative case. A case runs one surface as a given tenant
// against tenant B's data and returns everything the caller received. The generator
// (isolation.test.ts) runs each case twice:
// - positive control: as tenant B itself, the result must contain B's marker, proving
//   the case really exercises the surface (a case that returns nothing fails);
// - negative: as tenant A, no B secret may appear, and `not-found` surfaces answer 404
//   (TEN-1: another tenant's object is not-found, never forbidden).
import type pg from "pg";
import type { SurfaceKind } from "./surfaces";

export type TenantFixture = { tenantId: string; branchId: string; legalName: string };

export type IsolationEnv = {
  app: pg.Pool; // clinic_app login, checked by openAppPool
  owner: pg.Pool; // database owner, for seeding fixtures only (never the surface under test)
  actor: TenantFixture; // the caller
  victim: TenantFixture; // tenant B, whose data the case targets
  // Rows the case seeds for B (patients, invoices, ...) must be registered here.
  victimSecret(value: string): void;
};

// Results are plain JSON values (no Response objects or streams) so nothing is hidden
// from the check by serialisation.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RouteResult = { status: number; body: Json };

type Base = {
  id: string;
  // The value from tenant B that a positive-control run must return.
  marker(env: IsolationEnv): string;
};

export type IsolationCase =
  | (Base & {
      kind: "route";
      // `not-found`: by-id or selector routes; `filtered`: lists answer 2xx without B rows.
      expect: "not-found" | "filtered";
      run(env: IsolationEnv): Promise<RouteResult>;
    })
  | (Base & { kind: Exclude<SurfaceKind, "route">; run(env: IsolationEnv): Promise<Json> });

export function defineCases(...cases: IsolationCase[]): IsolationCase[] {
  return cases;
}
