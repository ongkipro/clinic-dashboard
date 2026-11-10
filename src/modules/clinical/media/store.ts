// MediaStore (PR-32, ARCH-9): where the bytes of clinical media live, content-addressed by sha256 under the
// tenant's prefix (tenants/<tenant>/clinical-media/<sha256>, TEN-4). The database store is the M2 store
// (DEC-027 precedent); an S3-compatible store with its endpoint from configuration replaces it later without a
// schema change. Both run inside the caller's tenant transaction: `put` needs an uploader context, `get` a
// token the caller has just redeemed.
import type pg from "pg";

export interface MediaStore {
  put(db: pg.ClientBase, o: { sha256: string; contentType: string; bytes: Buffer }): Promise<{ objectKey: string }>;
  get(db: pg.ClientBase, o: { tokenHash: string; objectKey: string }): Promise<Buffer>;
}

export const dbMediaStore: MediaStore = {
  async put(db, o) {
    const r = await db.query(`select media_blob_put($1, $2, $3) as k`, [o.sha256, o.contentType, o.bytes]);
    return { objectKey: r.rows[0].k as string };
  },
  async get(db, o) {
    return (await db.query(`select media_blob_get($1) as b`, [o.tokenHash])).rows[0].b as Buffer;
  },
};
