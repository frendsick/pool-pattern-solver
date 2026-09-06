import { describe, it, expect } from 'vitest';
import { vec, add, scale, rotate, norm, sub, angleBetween } from '../src/geometry';
import { BALL_R, Layout, pocketById } from '../src/table';
import { INTERMEDIATE, powerFactor } from '../src/skill';
import { solve, solveFromCue } from '../src/solver';

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
    // Physical rolling-energy units at µ_roll = 0.01: firm position shots
    // near 2 m/s stay comfortable. Power shots near 3.2 m/s reach the ceiling.
    expect(powerFactor(800, INTERMEDIATE)).toBeGreaterThan(0.97);
    expect(powerFactor(1100, INTERMEDIATE)).toBeGreaterThan(0.9);
    expect(powerFactor(2000, INTERMEDIATE)).toBe(0);
    expect(powerFactor(1700, INTERMEDIATE)).toBeLessThan(0.65);
  });

  it('offers the top-right follow along the window from a placed cue', () => {
    const ball = layout.balls[0].pos;
    const aim = norm(sub(pocketById('TR').target, ball));
    const ghost = sub(ball, scale(aim, 2 * BALL_R));
    const cue = add(ghost, scale(rotate(scale(aim, -1), -10 * Math.PI / 180), 8));
    const pattern = solveFromCue(layout, INTERMEDIATE, 0, cue)!;
    expect(pattern).not.toBeNull();
    const s1 = pattern.shots[0];
    expect(s1.pocket.id).toBe('TR');
    expect(s1.type).toBe('follow');
    expect(s1.rails).toBeGreaterThanOrEqual(1);
    expect(s1.rails).toBeLessThanOrEqual(2);
    // The path's final leg runs close to the 6 -> BL line (the window's
    // long axis), not across it like the old bottom-right plan.
    const path = s1.path!;
    const leg = sub(path[path.length - 1], path[path.length - 2]);
    const line = norm(sub(pocketById('BL').target, layout.balls[1].pos));
    const a = angleBetween(leg, line);
    expect(Math.min(a, Math.PI - a)).toBeLessThan((15 * Math.PI) / 180);
    // Exact rail power and straight-only stops narrow the onward window.
    expect(s1.zoneLen!).toBeGreaterThan(6);
    // The corrected mouth keeps this route available, but its tail now
    // scores below the bottom-right Pattern chosen by the free placement search.
    expect(pattern.score).toBeGreaterThan(0.17);
  });

  it('the landing leaves a small working angle on the 6, not dead straight', () => {
    const pattern = solve(layout, INTERMEDIATE)!;
    const s2 = pattern.shots[1];
    expect(s2.pocket.id).toBe('BL');
    expect(s2.cutDeg).toBeGreaterThan(1);
    expect(s2.cutDeg).toBeLessThan(35);
    // The corrected search accepts a harder 6 for a stronger remaining Pattern.
    expect(s2.potProb).toBeGreaterThan(0.75);
    expect(pattern.score).toBeGreaterThan(0.2);
  });
});
