import { describe, it, expect } from 'vitest';
import { vec, norm, scale, sub, angleBetween } from '../src/geometry';
import { Layout, pocketById } from '../src/table';
import { INTERMEDIATE, powerFactor } from '../src/skill';
import { solve } from '../src/solver';

// Image #30 (2026-06-12, round 19): ball in hand on a 5-9 layout. The solver
// potted the 5 bottom-right and sent a one-rail follow UP across the 6's
// window (4" of path inside it, position 65%). User: "I would shoot the five
// to top-right corner with follow one rail to move along the position window
// instead of across it." The quadrature always preferred the along-window
// arrival; the route lost to three taxes stacked against it — the placement
// grid only offered the right-side seed inside the rail band (railComfort
// x0.79), the interval candidates skipped the line's best landing (peakS),
// and powerFactor priced a routine firm follow as a power stroke
// (hitComfort 150" -> 250").
describe('along-the-window follow (image #30, round 19)', () => {
  const layout: Layout = {
    seed: 0,
    balls: [
      { num: 5, pos: vec(88.3, 15.9) },
      { num: 6, pos: vec(35.9, 23.7) },
      { num: 7, pos: vec(6.9, 37.4) },
      { num: 8, pos: vec(21.2, 26.0) },
      { num: 9, pos: vec(41.5, 18.9) },
    ],
  };

  it('a 60" one-rail position follow is a routine stroke, a near-straight monster still dies', () => {
    // 20 deg cut keeps sin^2 + k^2 cos^2 ~ 0.19 of the hit: 61" of travel
    // demands a ~320" equivalent roll-out — firm, not a power shot.
    expect(powerFactor(320, INTERMEDIATE)).toBeGreaterThan(0.97);
    // The round-6 monsters (near-straight sideways routes) keep dying.
    expect(powerFactor(700, INTERMEDIATE)).toBe(0);
    expect(powerFactor(550, INTERMEDIATE)).toBeLessThan(0.6);
  });

  it('pots the 5 top-right and follows one rail along the window, not across it', () => {
    const pattern = solve(layout, INTERMEDIATE)!;
    expect(pattern).not.toBeNull();
    const s1 = pattern.shots[0];
    expect(s1.pocket.id).toBe('TR');
    expect(s1.type).toBe('follow');
    expect(s1.rails).toBe(1);
    // The path's final leg runs along the 6 -> BL line (the window's long
    // axis), not across it: was 84 deg off the line via the bottom-right plan.
    const path = s1.path!;
    const leg = sub(path[path.length - 1], path[path.length - 2]);
    const line = norm(sub(pocketById('BL').target, layout.balls[1].pos));
    const a = angleBetween(leg, line);
    expect(Math.min(a, Math.PI - a)).toBeLessThan((40 * Math.PI) / 180);
    expect(s1.eNext!).toBeGreaterThan(0.7); // was 0.652 crossing
    // The whole rack firms up over the crossing plan's 0.335.
    expect(pattern.score).toBeGreaterThan(0.36);
  });

  it('the landing leaves a small working angle on the 6, not dead straight', () => {
    const pattern = solve(layout, INTERMEDIATE)!;
    const s2 = pattern.shots[1];
    expect(s2.pocket.id).toBe('BL');
    expect(s2.cutDeg).toBeGreaterThan(1);
    expect(s2.cutDeg).toBeLessThan(35);
    expect(s2.potProb).toBeGreaterThan(0.85); // was 0.787 from the far landing
  });
});
