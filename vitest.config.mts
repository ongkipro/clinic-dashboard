// HYG-004: every integration file closes its throwaway database in afterAll (pools, DROP
// DATABASE … WITH (FORCE), DROP ROLE). Under a busy full suite that can exceed vitest's
// default 10 s hook limit and fail a file whose tests all passed. Hooks get the 120 s the
// slow beforeAll hooks already use; test bodies keep their own limits.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    hookTimeout: 120_000,
  },
});
