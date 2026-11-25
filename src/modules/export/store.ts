// ExportStore port (T-122 D5a + Finding #7): abstracts archive file byte persistence behind a single
// guarded port. Pilot adapter uses PostgreSQL bytea via SECURITY DEFINER functions; upgrading to
// S3-compatible object storage (ARCH-9 configured endpoint) requires zero schema or caller changes.
// lazy: bytea in DB; upgrade = S3 adapter via ARCH-9 config.
import type pg from "pg";
import { ExportRuleError, MAX_FILE_BYTES, sha256, type FileKind } from "./export";

export type PutExportFileInput = {
  exportId: string;
  generation: number;
  path: string;
  kind: FileKind;
  bytes: Uint8Array;
};

export interface ExportStore {
  put(db: pg.ClientBase, input: PutExportFileInput): Promise<void>;
}

export const dbExportStore: ExportStore = {
  async put(db, input) {
    if (input.bytes.byteLength > MAX_FILE_BYTES) {
      throw new ExportRuleError("ERR_INVALID_INPUT", "export_file_too_large");
    }
    const digest = sha256(input.bytes);
    await db.query(`select public.export_put_file($1, $2, $3, $4, $5, $6)`, [
      input.exportId,
      input.generation,
      input.path,
      input.kind,
      digest,
      Buffer.from(input.bytes),
    ]);
  },
};
