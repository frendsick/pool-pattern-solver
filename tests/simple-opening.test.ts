import { describe, it, expect } from 'vitest';
import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';

// Feedback (seed 775832494, n=9): after potting the 1 the cue is already on
// the 2's line, so the opening shot should be a stop / short draw with very
// little cue-ball movement. clearanceRisk (round 22) regressed it into a 38"
// one-rail follow: a later draw skimmed the 7 at ~0.2", and with the penalty
// at its original 0.5 floor that near-miss was a 42% score cut — heavy enough
// that the beam re-routed the WHOLE rack into follows to dodge it. The graze
// is a glance, not a scratch; gentling BLOCK_FLOOR makes clearanceRisk a
// near-tie nudge again (it still flips seed 1147167, locked separately in
// tests/blocked-route.test.ts) instead of a multiplier that overrides the
// run-out economics "keep it simple" depends on.
describe('a clean stop-in opening is not re-routed to dodge a later graze (seed 775832494)', () => {
  const layout: Layout = {
    seed: 775832494,
    balls: [
      { num: 1, pos: vec(40.3, 14.3) },
      { num: 2, pos: vec(17.1, 10.7) },
      { num: 3, pos: vec(61.9, 8.4) },
      { num: 4, pos: vec(49.9, 5.8) },
      { num: 5, pos: vec(52.6, 41.1) },
      { num: 6, pos: vec(47.2, 37.4) },
      { num: 7, pos: vec(55.4, 16.9) },
      { num: 8, pos: vec(77.2, 13.1) },
      { num: 9, pos: vec(25.4, 5.1) },
    ],
  };

  it('opens with a low-movement shot, not a long one-rail follow', () => {
    const pattern = solve(layout, INTERMEDIATE);
    expect(pattern).not.toBeNull();

    const open = pattern!.shots[0];
    // The cue is already near the 2's window; the opener should barely move it.
    expect(open.rails).toBe(0);
    expect(open.travel ?? 0).toBeLessThan(15);
    // Specifically not the regressed line (a multi-inch rail follow).
    expect(open.type === 'follow' && open.rails >= 1).toBe(false);
  });
});
