import { describe, it, expect } from 'vitest';
import { vec, add, scale, rotate } from '../src/geometry';
import { pocketById, BALL_R } from '../src/table';
import { shotGeometry } from '../src/shots';
import { potProbability, distanceSigma, directionSigma, INTERMEDIATE } from '../src/skill';

describe('pot probability model', () => {
  const ball = vec(50, 25);
  const ts = pocketById('TS');

  const probAt = (cueDist: number, cutDeg: number): number => {
    const aimBack = vec(0, -1);
    const ghost = add(ball, scale(aimBack, 2 * BALL_R));
    const c = add(ghost, scale(rotate(aimBack, (cutDeg * Math.PI) / 180), cueDist));
    const g = shotGeometry(c, ball, ts)!;
    return potProbability(g, ts, INTERMEDIATE);
  };

  it('longer cue-ball distance lowers the probability', () => {
    expect(probAt(15, 0)).toBeGreaterThan(probAt(40, 0));
  });

  it('thinner cuts lower the probability', () => {
    expect(probAt(20, 0)).toBeGreaterThan(probAt(20, 30));
    expect(probAt(20, 30)).toBeGreaterThan(probAt(20, 55));
  });

  it('cuts beyond maxCut (60°) are impossible', () => {
    expect(probAt(20, 65)).toBe(0);
    expect(probAt(20, 85)).toBe(0);
  });

  it('beyond a quarter-ball hit (48°), only close-range cuts are on', () => {
    expect(probAt(20, 55)).toBeGreaterThan(0); // within ~1 m
    expect(probAt(45, 55)).toBe(0); // same cut, too far
    expect(probAt(45, 40)).toBeGreaterThan(0); // comfortable cut, distance fine
  });

  it('side pockets reject shallow approaches', () => {
    // Ball near the bottom rail aimed almost parallel into the side pocket.
    const b = vec(20, 2.5);
    const bs = pocketById('BS'); // target (50, 0)
    const g = shotGeometry(vec(10, 3.5), b, bs)!;
    expect(potProbability(g, bs, INTERMEDIATE)).toBe(0);
  });

  it('a comfortable straight shot is highly makeable', () => {
    expect(probAt(20, 0)).toBeGreaterThan(0.85);
  });
});

describe('position error model', () => {
  it('draw gets harder past ~1 m of cue-to-ball distance', () => {
    const near = distanceSigma('draw', 30, 0, INTERMEDIATE, 30);
    const far = distanceSigma('draw', 30, 0, INTERMEDIATE, 70);
    expect(far).toBeGreaterThan(near);
    expect(directionSigma('draw', 0, INTERMEDIATE, 70)).toBeGreaterThan(
      directionSigma('draw', 0, INTERMEDIATE, 30),
    );
  });

  it('follow and a touch of low are unaffected by shot distance', () => {
    expect(distanceSigma('follow', 30, 0, INTERMEDIATE, 70)).toBe(
      distanceSigma('follow', 30, 0, INTERMEDIATE, 30),
    );
    expect(distanceSigma('lowTouch', 30, 0, INTERMEDIATE, 70)).toBe(
      distanceSigma('lowTouch', 30, 0, INTERMEDIATE, 30),
    );
  });

  it('a touch of low is easier than stun and draw, harder than follow', () => {
    const s = (t: 'follow' | 'lowTouch' | 'stun' | 'draw') =>
      distanceSigma(t, 30, 0, INTERMEDIATE);
    expect(s('lowTouch')).toBeGreaterThan(s('follow'));
    expect(s('lowTouch')).toBeLessThan(s('stun'));
    expect(s('lowTouch')).toBeLessThan(s('draw'));
  });
});
