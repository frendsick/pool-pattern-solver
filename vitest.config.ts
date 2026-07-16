import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Golden tests run full solves (the generator ones, hundreds of them) and
    // sit near vitest's 5 s default when every worker is busy: give the
    // suite headroom so parallel runs under load don't time-trip.
    testTimeout: 60_000,
  },
});
