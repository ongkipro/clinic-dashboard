// Source-ID duplicate, idempotent replay, conflict, reversal-tombstone, and NIK-collision evaluator (PR-85, DATA-58; T-128).
// Pure deterministic contract: zero plaintext external IDs, NIKs, or PII in any decision or diagnostic.
import type { ImportEntityKind, NormalizedRow } from "./parser";

export type ExistingSourceMapEntry = {
  entity: ImportEntityKind;
  sourceKeyHash: string;
  canonicalPayloadSha256: string;
  localId: string;
  state: "active" | "reversed";
};

export type ExistingPatientNikEntry = {
  nikHash: string;
  localId: string;
  sourceKeyHash?: string | null;
};

export type SourceIdDecision =
  | {
      kind: "new";
      entity: ImportEntityKind;
      rowNo: number;
      sourceKeyHash: string;
      canonicalPayloadSha256: string;
    }
  | {
      kind: "replay";
      entity: ImportEntityKind;
      rowNo: number;
      sourceKeyHash: string;
      canonicalPayloadSha256: string;
      existingLocalId: string;
    }
  | {
      kind: "reimport_after_reversal";
      entity: ImportEntityKind;
      rowNo: number;
      sourceKeyHash: string;
      canonicalPayloadSha256: string;
      priorLocalId: string;
    }
  | {
      kind: "conflict";
      code: "ERR_SOURCE_CONFLICT";
      entity: ImportEntityKind;
      rowNo: number;
      sourceKeyHash: string;
      existingLocalId: string;
    }
  | {
      kind: "nik_conflict";
      code: "ERR_DUPLICATE_NIK";
      entity: "patients";
      rowNo: number;
      sourceKeyHash: string;
      existingLocalId: string;
    };

export type SourceIdPlan = {
  ok: boolean;
  decisions: SourceIdDecision[];
  conflicts: Extract<SourceIdDecision, { kind: "conflict" | "nik_conflict" }>[];
  counts: {
    new: number;
    replay: number;
    reimportAfterReversal: number;
    conflict: number;
    nikConflict: number;
  };
};

const mapKey = (entity: ImportEntityKind, sourceKeyHash: string) => `${entity}:${sourceKeyHash}`;

export function evaluateSourceIdPlan(
  rows: readonly NormalizedRow[],
  existingMaps: readonly ExistingSourceMapEntry[],
  existingPatientNiks: readonly ExistingPatientNikEntry[] = [],
): SourceIdPlan {
  const activeByKey = new Map<string, ExistingSourceMapEntry>();
  const reversedByKey = new Map<string, ExistingSourceMapEntry>();
  for (const m of existingMaps) {
    const k = mapKey(m.entity, m.sourceKeyHash);
    if (m.state === "active") {
      activeByKey.set(k, m);
    } else if (!reversedByKey.has(k)) {
      reversedByKey.set(k, m);
    }
  }

  const nikByHash = new Map<string, ExistingPatientNikEntry>();
  for (const entry of existingPatientNiks) {
    nikByHash.set(entry.nikHash, entry);
  }

  const decisions: SourceIdDecision[] = [];
  const conflicts: Extract<SourceIdDecision, { kind: "conflict" | "nik_conflict" }>[] = [];
  const counts = { new: 0, replay: 0, reimportAfterReversal: 0, conflict: 0, nikConflict: 0 };

  for (const row of rows) {
    const k = mapKey(row.entity, row.sourceKeyHash);
    const active = activeByKey.get(k);
    if (active) {
      if (active.canonicalPayloadSha256 !== row.canonicalPayloadSha256) {
        const d: Extract<SourceIdDecision, { kind: "conflict" }> = {
          kind: "conflict",
          code: "ERR_SOURCE_CONFLICT",
          entity: row.entity,
          rowNo: row.rowNo,
          sourceKeyHash: row.sourceKeyHash,
          existingLocalId: active.localId,
        };
        decisions.push(d);
        conflicts.push(d);
        counts.conflict += 1;
        continue;
      }

      if (row.entity === "patients" && row.nikHash) {
        const nikMatch = nikByHash.get(row.nikHash);
        if (nikMatch && nikMatch.localId !== active.localId) {
          const d: Extract<SourceIdDecision, { kind: "nik_conflict" }> = {
            kind: "nik_conflict",
            code: "ERR_DUPLICATE_NIK",
            entity: "patients",
            rowNo: row.rowNo,
            sourceKeyHash: row.sourceKeyHash,
            existingLocalId: nikMatch.localId,
          };
          decisions.push(d);
          conflicts.push(d);
          counts.nikConflict += 1;
          continue;
        }
      }

      decisions.push({
        kind: "replay",
        entity: row.entity,
        rowNo: row.rowNo,
        sourceKeyHash: row.sourceKeyHash,
        canonicalPayloadSha256: row.canonicalPayloadSha256,
        existingLocalId: active.localId,
      });
      counts.replay += 1;
      continue;
    }

    if (row.entity === "patients" && row.nikHash) {
      const nikMatch = nikByHash.get(row.nikHash);
      if (nikMatch && nikMatch.sourceKeyHash !== row.sourceKeyHash) {
        const d: Extract<SourceIdDecision, { kind: "nik_conflict" }> = {
          kind: "nik_conflict",
          code: "ERR_DUPLICATE_NIK",
          entity: "patients",
          rowNo: row.rowNo,
          sourceKeyHash: row.sourceKeyHash,
          existingLocalId: nikMatch.localId,
        };
        decisions.push(d);
        conflicts.push(d);
        counts.nikConflict += 1;
        continue;
      }
    }

    const reversed = reversedByKey.get(k);
    if (reversed) {
      decisions.push({
        kind: "reimport_after_reversal",
        entity: row.entity,
        rowNo: row.rowNo,
        sourceKeyHash: row.sourceKeyHash,
        canonicalPayloadSha256: row.canonicalPayloadSha256,
        priorLocalId: reversed.localId,
      });
      counts.reimportAfterReversal += 1;
      continue;
    }

    decisions.push({
      kind: "new",
      entity: row.entity,
      rowNo: row.rowNo,
      sourceKeyHash: row.sourceKeyHash,
      canonicalPayloadSha256: row.canonicalPayloadSha256,
    });
    counts.new += 1;
  }

  return {
    ok: conflicts.length === 0,
    decisions,
    conflicts,
    counts,
  };
}

export type BatchOverlap = {
  entity: ImportEntityKind;
  sourceKeyHash: string;
  firstRowNo: number;
  secondRowNo: number;
  kind: "identical_replay" | "ERR_SOURCE_CONFLICT";
};

// Detects overlapping source keys between two candidate batches before staging/apply.
export function detectBatchOverlap(
  firstBatchRows: readonly NormalizedRow[],
  secondBatchRows: readonly NormalizedRow[],
): BatchOverlap[] {
  const firstByKey = new Map<string, NormalizedRow>();
  for (const r of firstBatchRows) {
    firstByKey.set(mapKey(r.entity, r.sourceKeyHash), r);
  }
  const overlaps: BatchOverlap[] = [];
  for (const r of secondBatchRows) {
    const prev = firstByKey.get(mapKey(r.entity, r.sourceKeyHash));
    if (!prev) continue;
    overlaps.push({
      entity: r.entity,
      sourceKeyHash: r.sourceKeyHash,
      firstRowNo: prev.rowNo,
      secondRowNo: r.rowNo,
      kind: prev.canonicalPayloadSha256 === r.canonicalPayloadSha256 ? "identical_replay" : "ERR_SOURCE_CONFLICT",
    });
  }
  return overlaps;
}
