import { describe, it, expect } from 'vitest';
import { vec, distPointSegment } from '../src/geometry';
import { Layout, BALL_R } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';

// Feedback (seed 1147167, n=4): the solver opened with a 6 -> bottom-side
// follow whose cue-ball path threaded the 9 with a 0.2" edge gap — "for most
// of the path the cue ball is blocked by the 9". A short clean follow to the
// top side reaches position for the 7 with every lane wide open and almost the
// same run-out value, so the blocked route should lose. The coarse landing
// quadrature can't see a centerline grazing a ball (it samples direction only
// at 0 and +/-1.732 sigma), so clearanceRisk prices the lane explicitly.
describe('blocked cue-ball routes lose to open lanes (seed 1147167)', () => {
  const layout: Layout = {
    seed: 1147167,
    balls: [
      { num: 6, pos: vec(43.1, 28.3) },
      { num: 7, pos: vec(53.3, 4.8) },
      { num: 8, pos: vec(63.4, 21.6) },
      { num: 9, pos: vec(64.6, 12.0) },
    ],
  };

  /** Smallest edge gap from a shot's cue path to a ball it is not playing. */
  function minNonTargetGap(path: typeof layout.balls[number]['pos'][] | null, later: typeof layout.balls): number {
    if (!path) return Infinity;
    let worst = Infinity;
    for (const b of later) {
      let d = Infinity;
      for (let k = 0; k + 1 < path.length; k++) {
        d = Math.min(d, distPointSegment(b.pos, path[k], path[k + 1]));
      }
      worst = Math.min(worst, d - 2 * BALL_R);
    }
    return worst;
  }

  it('does not thread a non-target ball when an open route exists', () => {
    const pattern = solve(layout, INTERMEDIATE);
    expect(pattern).not.toBeNull();

    const s1 = pattern!.shots[0];
    // The old blocked route was 6 -> BS, a one-rail follow grazing the 9.
    expect(!(s1.pocket.id === 'BS' && s1.type === 'follow' && s1.rails >= 1)).toBe(true);

    // No shot's cue path is allowed to thread (within a ball radius of) a ball
    // it is not playing position for. The chosen pattern clears by ~5.6".
    for (const shot of pattern!.shots) {
      const later = layout.balls.filter((b) => b.num > shot.ball.num);
      expect(minNonTargetGap(shot.path, later)).toBeGreaterThan(BALL_R);
    }

    // Safety came nearly free: the open pattern is barely below the blocked
    // one's old 0.368 — not a collapse to some far worse line.
    expect(pattern!.score).toBeGreaterThan(0.33);
  });
});
