import { describe, it, expect } from 'vitest';
import { vec } from '../src/geometry';
import { Layout, pocketById } from '../src/table';
import { INTERMEDIATE, potProbability } from '../src/skill';
import { shotGeometry } from '../src/shots';
import { solve } from '../src/solver';

// Round 16 (2026-06-12, follow-up to images #27/#28, seed 671833607): the
// user twice preferred finishing on the 9 INTO THE SIDE from the big
// right-side window, but the solver kept choosing a ~45" near-straight 9 to
// the top-right corner because mid-range pots read too confident (96% with
// the cue parked close behind). The honest lever is throwSigma: object-ball
// direction noise at contact is distance-independent, so the pocket's
// shrinking angular window must dominate at range. 0.012 -> 0.02 prices a
// mid-range straight pot as genuinely missable while a near-hanging ball
// stays a formality — and the side-pocket finish wins on its own.
describe('mid-range pot honesty (2026-06-12 round 16)', () => {
  it('a 45" straight corner pot is missable; a hanging side ball is not', () => {
    const tr = pocketById('TR');
    const f = tr.facing;
    const ball = { x: tr.target.x - f.x * 45, y: tr.target.y - f.y * 45 };
    const cue = { x: ball.x - f.x * 12, y: ball.y - f.y * 12 };
    const mid = potProbability(shotGeometry(cue, ball, tr)!, tr, INTERMEDIATE);
    expect(mid).toBeLessThan(0.96); // was 0.99 with the cue parked behind
    expect(mid).toBeGreaterThan(0.85); // still a shot you expect to make

    const ts = pocketById('TS');
    const hang = { x: ts.target.x, y: ts.target.y - 12 };
    const cue2 = { x: hang.x, y: hang.y - 15 };
    const short = potProbability(shotGeometry(cue2, hang, ts)!, ts, INTERMEDIATE);
    expect(short).toBeGreaterThan(0.995);
  });

  it('finishes the 9 into the side from the right-side window', () => {
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
    const nine = pattern.shots[2];
    expect(nine.pocket.id).toBe('TS');
    // Cue ball in the big right-side window: below-right of the 9, on the
    // pot line's extension — not parked up-table for a long corner 9.
    expect(nine.cuePos.x).toBeGreaterThan(layout.balls[2].pos.x);
    expect(nine.cuePos.y).toBeLessThan(layout.balls[2].pos.y);
    expect(nine.potProb).toBeGreaterThan(0.99);
  });
});
