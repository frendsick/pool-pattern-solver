import { describe, it, expect } from 'vitest';
import { vec, dist } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';

// Feedback (seed 149894255, n=9, round 24): the rack left the cue DEAD STRAIGHT
// on the 4 (a ~4 deg cut), and from there the only leave on the 5 was the full
// length of the table — a stop shot parked ~80" away with the 5 still ~57% to
// run out. "I would not want to leave a full-table shot when I can easily get
// to the middle of the table. Penalize the over-half-table shots progressively.
// The mistake happens on the shot from three to four: we leave ourselves too
// straight. The position window for the four should be tighter — leaving an
// angle from which we can get more aggressively to the five."
//
// Root cause: pot probability saturates for easy balls (erf flattens near 1),
// so position value was blind to distance-to-the-next-ball — a dead-straight,
// full-table leave scored as well as a closer, angled one. `proximity`
// (src/zone.ts) penalizes leaves past half the long rail, which both shortens
// far leaves directly and, propagating through the value surfaces, makes
// onward control devalue a straight leave whose only cheap exit stays
// full-table from the next ball. The fix leaves an angle on the 4 and brings
// the cue to mid-table for the 5.
describe('get closer to the next ball, not a full-table leave (seed 149894255)', () => {
  const layout: Layout = {
    seed: 149894255,
    balls: [
      { num: 1, pos: vec(50.4225, 26.6757) },
      { num: 2, pos: vec(6.4269, 4.6292) },
      { num: 3, pos: vec(57.5879, 11.0109) },
      { num: 4, pos: vec(83.6893, 11.3733) },
      { num: 5, pos: vec(6.5574, 40.1774) },
      { num: 6, pos: vec(5.8138, 11.1496) },
      { num: 7, pos: vec(24.4887, 42.9069) },
      { num: 8, pos: vec(15.5792, 30.1752) },
      { num: 9, pos: vec(68.4442, 12.9331) },
    ],
  };

  it('leaves an angle on the 4 and brings the cue to the 5, not full-table away', () => {
    const pattern = solve(layout, INTERMEDIATE);
    expect(pattern).not.toBeNull();

    const s4 = pattern!.shots[3];
    expect(s4.ball.num).toBe(4);
    // An angle on the 4 — not the dead-straight ~4 deg leave that traps the cue.
    expect(s4.cutDeg).toBeGreaterThan(12);

    // The leave on the 5 reaches mid-table, not the full length of the table.
    const ball5 = layout.balls[4].pos;
    expect(s4.landing).not.toBeNull();
    expect(dist(s4.landing!, ball5)).toBeLessThan(60);
  });
});
