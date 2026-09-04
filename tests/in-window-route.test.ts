import { beforeAll, describe, it, expect } from 'vitest';
import { distPointSegment, vec } from '../src/geometry';
import { CUE_OBSTACLE_CLEARANCE, Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { previewLegFromCue, solve, solveFromCue } from '../src/solver';
import { originWindowForStep } from '../src/scene';
import { clampCuePosition, legalCuePosition, pointInPolygons } from '../src/interaction';
import { zoneValue } from '../src/zone';

// Feedback (seed 775832494, n=9, round 23): on the 7 the cue is already on the
// 8's line, so a low touch that stays INSIDE the 8's window the whole way is
// the play. The solver instead followed one rail 47" — a route that grazes
// ~45% of its path OUTSIDE the window — to reach a marginally richer landing.
// "If we can stay inside or very close to the position window for the whole
// path after contact, prioritize that." redundantLongFollowFactor already
// penalizes a long rail-follow when a comparable in-window route exists; its
// travel ramp was too slow (a 47" follow took only a ~3% cut). Sharpened so
// the in-window touch wins here, while a long follow that is the ONLY way to a
// far window (handball-long-follow, along-window) keeps its value because no
// comparable in-window route exists (the penalty gates on `closeness`).
describe('prefer an in-window touch over a long rail-follow that leaves the window (seed 775832494)', () => {
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
  let pattern: NonNullable<ReturnType<typeof solve>>;
  beforeAll(() => {
    pattern = solve(layout, INTERMEDIATE)!;
    expect(pattern).not.toBeNull();
  }, 60_000);

  it('excludes the 4-ball clearance ring and clamps to a playable continuation (#29)', () => {
    const cue = vec(50, 8.08);
    const origin = originWindowForStep(pattern, 4, INTERMEDIATE);
    const balls = layout.balls.slice(2);
    const zone = pattern.shots[1].zone!;

    expect(zoneValue(cue, zone, INTERMEDIATE)).toBe(0);
    expect(solveFromCue(layout, INTERMEDIATE, 2, cue)).toBeNull();
    expect(pointInPolygons(cue, origin)).toBe(false);
    expect(legalCuePosition(cue, balls)).toBe(false);
    expect(pointInPolygons(pattern.shots[2].cuePos, origin)).toBe(true);
    for (const poly of origin) for (let i = 0; i < poly.length; i++) {
      for (const obstacle of zone.obstacles) {
        expect(distPointSegment(obstacle, poly[i], poly[(i + 1) % poly.length]))
          .toBeGreaterThanOrEqual(CUE_OBSTACLE_CLEARANCE);
      }
    }

    const clamped = clampCuePosition(cue, origin, balls);
    expect(clamped).not.toEqual(cue);
    expect(origin.some((poly) => poly.some((p, i) =>
      distPointSegment(clamped, p, poly[(i + 1) % poly.length]) < 1e-9,
    ))).toBe(true);
    expect(legalCuePosition(clamped, balls)).toBe(true);
    expect(zoneValue(clamped, zone, INTERMEDIATE)).toBeGreaterThan(0);
    expect(previewLegFromCue(layout, INTERMEDIATE, 2, clamped, pattern.shots[2].zone!)).not.toBeNull();
    expect(solveFromCue(layout, INTERMEDIATE, 2, clamped)).not.toBeNull();
  });

  it('plays the 7 with a short in-window route, not a 47" one-rail follow', () => {
    const s7 = pattern.shots[6];
    expect(s7.ball.num).toBe(7);
    // A low-movement route that stays in the 8's window — not the rail loop.
    expect(s7.rails).toBe(0);
    expect(s7.travel ?? 0).toBeLessThan(15);
    expect(s7.type === 'follow' && s7.rails >= 1).toBe(false);
  });
});
