// HYG-004: every integration file closes its throwaway database in afterAll (pools, DROP
// DATABASE … WITH (FORCE), DROP ROLE). Under a busy full suite that can exceed vitest's
// default 10 s hook limit and fail a file whose tests all passed. Hooks get the 120 s the
// slow beforeAll hooks already use; test bodies keep their own limits.
import { defineConfig } from "vitest/config";

//
// HYG-006 / HYG-011 (2026-11-06): test bodies get 30 s. The 5 s default failed integration tests
// on this shared machine whenever other projects' suites ran: measured at load 12, the slowest
// default-limit tests took 2.1-4.1 s (events 200-event drain 4.1 s, auth 2.5 s, security 2.4 s),
// and at load 14-16 they crossed 5 s (`/data/tmp/hyg006/full-1793936727/`). The base commit
// failed the same way, and the same files passed alone. These tests assert behaviour, not speed;
// the limit only has to catch a hang, which 30 s still does. Tests whose timing is the point keep
// their own explicit limits.
export default defineConfig({
  test: {
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
