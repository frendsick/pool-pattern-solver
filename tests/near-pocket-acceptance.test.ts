import { describe, it, expect } from 'vitest';
import { vec, scale, sub } from '../src/geometry';
import { Layout, pocketById, effectiveAcceptance } from '../src/table';
import { INTERMEDIATE, potProbability } from '../src/skill';
import { shotGeometry } from '../src/shots';
import { zoneContext, zonePeak } from '../src/zone';
import { solve } from '../src/solver';

// Image #26 (2026-06-12, seed 671833607): the 8 hangs 5.5" from the top side
// pocket, approaching 45.5 deg off the facing — beyond the far-field 38 deg
// cone, so the side pocket read as unpottable and the solver sent the 8
// cross-table to a corner. Closer pockets need much less accuracy, and up
// close the cone logic stops applying: acceptance now widens near the mouth
// (effectiveAcceptance), making the hanging-ball side-pocket shot the
// near-certainty it is on a real table.
describe('near-pocket acceptance (image #26, 2026-06-12 round 14)', () => {
  const seven = vec(79.14250206190627, 23.35260529705556);
  const eight = vec(46.1013758329791, 46.17105562554207);
  const nine = vec(55.87119109847117, 39.554990234959405);
  const ts = pocketById('TS');

  it('the cone widens near the mouth and is nominal at distance', () => {
    expect(effectiveAcceptance(ts, 5.5)).toBeGreaterThan((45.5 * Math.PI) / 180);
    expect(effectiveAcceptance(ts, 60)).toBeLessThan((38.2 * Math.PI) / 180);
  });

  it('a ball hanging by the side pocket pots at a steep angle; the same angle far out does not', () => {
    const g = shotGeometry(vec(30, 33), eight, ts)!;
    expect(potProbability(g, ts, INTERMEDIATE)).toBeGreaterThan(0.9);

    // Same approach line with the ball pulled 30" from the mouth: the jaw
    // facings reject it — the far-field cone is unchanged.
    const approach = scale(sub(ts.target, eight), 1 / Math.hypot(ts.target.x - eight.x, ts.target.y - eight.y));
    const farBall = sub(ts.target, scale(approach, 30));
    const farCue = sub(farBall, scale(approach, 20));
    const gFar = shotGeometry(farCue, farBall, ts)!;
    expect(potProbability(gFar, ts, INTERMEDIATE)).toBe(0);
  });

  it('the side pocket the 8 hangs by carries a full zone', () => {
    expect(zonePeak(zoneContext(eight, ts, [nine]), INTERMEDIATE)).toBeGreaterThan(0.95);
  });

  it('the solver plays the 8 into the side pocket it hangs by', () => {
    const layout: Layout = {
      balls: [
        { num: 7, pos: seven },
        { num: 8, pos: eight },
        { num: 9, pos: nine },
      ],
      seed: 671833607,
    };
    const pattern = solve(layout, INTERMEDIATE)!;
    expect(pattern).not.toBeNull();
    expect(pattern.shots[1].pocket.id).toBe('TS');
    expect(pattern.score).toBeGreaterThan(0.7);
  });
});
