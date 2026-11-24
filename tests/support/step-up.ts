// HYG-026 test seam: a step-up the consumers' own suites pass to signRecord / signLetter / signPrescription without a
// TOTP round trip. verifyStepUp accepts it only under Vitest (NODE_ENV "test"); the seam throws anywhere else, and a
// source guard (tests/auth/step-up.test.ts) refuses any src/ file that names it.
export { stepUpTestSeam as stepUpForTests } from "../../src/auth/server";
