import { describe, it, expect } from 'vitest';
import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE, distanceSigma } from '../src/skill';
import { solve } from '../src/solver';

// Images #27/#28 (2026-06-12, seed 671833607): the solver parked the cue ball
// 40" from the 8 for a "stop shot — stays put", leaving a long 9. A stop is
// only surgical up close: with distance, killing the cue ball exactly gets
// harder, and the residual roll drifts it along the aim line — forward,
// toward the pocket the object ball just dropped in (stopDrift, and the
// symmetric kill-drift branch of expectedNextPot). The honest price makes the
// player's pattern win: take an angle on the 8 and flow to the 9's window.
describe('long-stop kill drift (2026-06-12 round 15)', () => {
  it('the stop landing spread grows with cue-to-ball distance', () => {
    const near = distanceSigma('stop', 0.5, 0, INTERMEDIATE, 10);
    const far = distanceSigma('stop', 0.5, 0, INTERMEDIATE, 41);
    expect(near).toBeLessThan(2);
    expect(far).toBeGreaterThan(3);
  });

  it('does not park 40" away from the 8 for a long stop', () => {
    const layout: Layout = {
      balls: [
        { num: 7, pos: vec(79.14250206190627, 23.35260529705556) },
        { num: 8, pos: vec(46.1013758329791, 46.17105562554207) },
        { num: 9, pos: vec(55.87119109847117, 39.554990234959405) },
      ],
      seed: 671833607,
    };
    const pattern = solve(layout, INTERMEDIATE)!;
    expect(pattern).not.toBeNull();
    const shot2 = pattern.shots[1];
    expect(shot2.pocket.id).toBe('TS');
    // The angled 8 that flows on beats the long park-and-stop.
    expect(shot2.type).not.toBe('stop');
    expect(shot2.cutDeg).toBeGreaterThan(12);
  });
});
