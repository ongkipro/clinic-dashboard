## Review

- **Fixed:** The entry-point count and `staff_state` success-branch exception are now accurately documented (`docs/tasks/HYG-008.md:500`; `ARCHITECTURE.md:86`). The approve-schedule and raw `ticket_exists` qualifications also address those parts of the finding.

- **Finding: LOW / P2 — One count overstatement remains.** `docs/tasks/HYG-008.md:506` includes “support open” among schedules asserting exactly one committed refusal row. The standalone `staff_access` support-open test checks the latest refusal and attribution, but does **not** count refusal rows (`tests/rls/vendor-authority.test.ts:164–167`).
  **Smallest fix:** Limit the exact-count claim to `waitedRefusal` and the support-ticket test; describe standalone support-open alongside approve as checking the latest attributed row. The foreign-key support-open schedule is already covered by `waitedRefusal`.

The LOW is therefore **partially, not fully, closed**. This remains a non-blocking documentation note; implementation approval is unchanged. Nothing executed or modified.

VERDICT: APPROVE