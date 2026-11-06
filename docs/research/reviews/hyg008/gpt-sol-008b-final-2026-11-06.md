## Review

Read-only review of the supplied fixed packet and targeted worktree context. Nothing executed; passing test and mutation results are supplied evidence, not independently rerun.

### Correct

- **Support-ticket bypass is closed.** `withSupportSession` now issues its ticket through the wrapped module `call()`, preserving `SupportBindError` handling rather than leaking the authority re-check’s raw 42501 (`src/modules/vendor/support/support.ts:71–78`). The real-helper regression test checks that the callback never runs, no ticket/binding survives, and exactly one attributed refusal commits (`tests/rls/vendor-authority.test.ts:178–215`).

- **Attribution no longer guesses from argument position.** Callers supply typed subjects, and the database resolves tenant/object attribution by subject kind (`src/modules/vendor/authority.ts:12–36`; `0049.sql:213–250`). The module helpers exclude non-console calls from wrapping. I found no remaining wrapper bypass among the token-taking `vendor_console_*` calls in `src/`; the direct `vendor_console_ip_allowed` call is a tokenless helper.

- **The two exception-handler exits are fixed.** Both `ticket_exists` and the transition handler invoke the re-check in the handler body, where its exception propagates, rather than in the protected section (`0049.sql:848–853, 945–959`). Their behavioral schedules and structural checks are present (`tests/rls/vendor-authority.test.ts:310–326, 357–389, 566–606`).

- **The requested wait schedules exist.** Target-staff row, both invitation-expiry updates, owner-invitation cancellation, transition row/handler, and support-open foreign-key waits are exercised (`tests/rls/vendor-authority.test.ts:259–354`). The shared schedule helper checks refusal, absent effect, exactly one authority-refusal row, and attribution.

- **Lock order and operator changes are sound on the changed surface.** The re-check adds no locking statement; `vendor_guard` reads TOTP after its existing `FOR SHARE` (`0049.sql:60–69, 177–205`). Operator authority includes role, enrolment, factor age and binding address; `operator_row_read` re-judges after its potentially blocking insert (`0049.sql:1088–1150`). The sweep re-reads eligibility after `staff_access` (`0049.sql:1229–1242`).

- **The three operator projections match the app’s grants.** The explicit lists at `0049.sql:1297–1303` match `0026_staff_access_rules.sql:22–23`, `0030_compliance_rules.sql:95–96`, and `0048_clinic_authority_wall_clock.sql:1084–1086`.

### Finding

**LOW / P2 — Documentation overstates universal exit and assertion coverage.**

**Locations:** `ARCHITECTURE.md:86`; `docs/tasks/HYG-008.md:500, 506`.

The new documentation says every post-guard exit is re-checked. However, `vendor_staff_update_checked` deliberately re-checks only success: its post-guard domain-refusal returns do not call the re-check (`0049.sql:1030–1060, 1077–1079`). The structural test explicitly skips inspecting this helper’s exits (`tests/rls/vendor-authority.test.ts:583–586`). This follows the plan’s explicit success-branch exception at `docs/tasks/HYG-008.md:225`, so I am **not** treating it as an implementation blocker.

Likewise, “Each waited refusal asserts … exactly one committed refusal row” is broader than the tests: the approve schedules inspect the latest refusal but do not count it, and the `ticket_exists` schedule intentionally tests the raw database exception rather than a separately committed wrapper refusal (`tests/rls/vendor-authority.test.ts:112–138, 357–389`).

**Smallest fix:** Narrow those documentation claims to describe the `staff_state` success-branch exception and distinguish exact-count wrapper schedules from raw-handler propagation tests. Also change “18 token-taking entry points” to **19**, matching the structural inventory.

### Merge verdict

**OK with notes.** No HIGH/MEDIUM implementation findings or remaining raw-authority-42501 caller bypass found on the changed surface. The documentation qualification above is non-blocking.

VERDICT: APPROVE