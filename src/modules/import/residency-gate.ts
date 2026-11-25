// Mandatory pre-staging residency & synthetic-environment gate for T-128 opening-data import (PR-85, ARCH-10, MIG-2).
// Wires directly to T-120's live realPatientGateStatus() (migration 0133_real_patient_gate.sql) BEFORE any staging occurs;
// never assumes unfinished SQL staging enforces the gate on its own.
import type pg from "pg";
import { CommandError } from "../../lib/command";
import { envOf, realPatientGateStatus, type DeployEnv } from "../platform/residency";
import { dryRunValidateImport, type DryRunResult, type ImportBatchInput } from "./parser";
import {
  evaluateSourceIdPlan,
  type ExistingPatientNikEntry,
  type ExistingSourceMapEntry,
  type SourceIdPlan,
} from "./source-id";

export class ImportResidencyBlockedError extends CommandError {
  constructor(readonly blockers: readonly string[]) {
    super("ERR_FORBIDDEN");
    this.name = "ImportResidencyBlockedError";
  }
}

export class ImportSyntheticOnlyError extends CommandError {
  constructor(readonly deployEnv: DeployEnv) {
    super("ERR_FORBIDDEN");
    this.name = "ImportSyntheticOnlyError";
  }
}

export type GateCheckResult = {
  deployEnv: DeployEnv;
  residencyBlockers: string[];
  allowed: boolean;
};

// Enforces T-120 real-patient residency/DPA gate BEFORE any import staging write can run:
// - In production (including unset/unknown DEPLOY_ENV, fail-closed): EVERY import is gated by
//   realPatientGateStatus(db, env) regardless of any caller `synthetic` flag; non-empty blockers throw.
// - In non-production (staging/demo/local): MIG-2 requires explicit `synthetic: true`; real patient
//   data is refused unconditionally. Also calls realPatientGateStatus(db, env) so tenant actor
//   authorization (owner/admin_pusat) and live residency status are always evaluated honestly.
export async function assertImportStagingGate(
  db: pg.ClientBase,
  opts: {
    synthetic: boolean;
    env?: Partial<Record<string, string>>;
  },
): Promise<GateCheckResult> {
  const env = opts.env ?? process.env;
  const deployEnv = envOf(env.DEPLOY_ENV);

  if (deployEnv !== "production" && !opts.synthetic) {
    throw new ImportSyntheticOnlyError(deployEnv);
  }

  const blockers = await realPatientGateStatus(db, env);
  if (deployEnv === "production" && blockers.length > 0) {
    throw new ImportResidencyBlockedError(blockers);
  }

  return {
    deployEnv,
    residencyBlockers: blockers,
    allowed: deployEnv === "production" ? blockers.length === 0 : opts.synthetic,
  };
}

export type PreparedImportDryRun =
  | {
      ok: false;
      stage: "validation";
      gate: GateCheckResult;
      validation: Extract<DryRunResult, { ok: false }>;
    }
  | {
      ok: false;
      stage: "source_conflict";
      gate: GateCheckResult;
      validation: Extract<DryRunResult, { ok: true }>;
      sourcePlan: SourceIdPlan;
    }
  | {
      ok: true;
      gate: GateCheckResult;
      validation: Extract<DryRunResult, { ok: true }>;
      sourcePlan: SourceIdPlan;
    };

// Runs the mandatory residency gate FIRST, then validates the batch and computes the deterministic
// source-ID duplicate/replay/conflict plan. Performs ZERO database writes.
export async function prepareImportDryRun(
  db: pg.ClientBase,
  opts: {
    synthetic: boolean;
    env?: Partial<Record<string, string>>;
    input: ImportBatchInput;
    existingMaps?: readonly ExistingSourceMapEntry[];
    existingPatientNiks?: readonly ExistingPatientNikEntry[];
  },
): Promise<PreparedImportDryRun> {
  const gate = await assertImportStagingGate(db, {
    synthetic: opts.synthetic,
    env: opts.env,
  });

  const validation = dryRunValidateImport(opts.input);
  if (!validation.ok) {
    return { ok: false, stage: "validation", gate, validation };
  }

  const sourcePlan = evaluateSourceIdPlan(
    validation.rows,
    opts.existingMaps ?? [],
    opts.existingPatientNiks ?? [],
  );
  if (!sourcePlan.ok) {
    return { ok: false, stage: "source_conflict", gate, validation, sourcePlan };
  }

  return { ok: true, gate, validation, sourcePlan };
}
