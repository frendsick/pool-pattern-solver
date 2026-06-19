import { describe, it, expect } from 'vitest';
import { vec, norm, dist } from '../src/geometry';
import { pocketById, Layout, MAX_Y, MIN_Y, TABLE_W } from '../src/table';
import { shotGeometry, minCueTravel, tracePath } from '../src/shots';
import {
  directionSigma,
  INTERMEDIATE,
  routeEase,
  sidespinReliability,
} from '../src/skill';
import { finalSafetyRoute } from '../src/route';
import { solve } from '../src/solver';
import { explainShot } from '../src/explain';
import type { PlannedShot } from '../src/solver';

describe('sidespin cue-ball model', () => {
  it('keeps mirror rebound without spin and bends left/right spin in opposite directions', () => {
    const start = vec(90, 25);
    const dir = norm(vec(1, 1));
    const neutral = tracePath(start, dir, 25, []);
    const right = tracePath(start, dir, 25, [], { sidespin: 0.5 });
    const left = tracePath(start, dir, 25, [], { sidespin: -0.5 });

    expect(neutral.rails).toBe(1);
    expect(right.rails).toBe(1);
    expect(left.rails).toBe(1);
    expect(dist(right.end, left.end)).toBeGreaterThan(0.8);
    expect(dist(neutral.end, right.end)).toBeGreaterThan(0.4);
    expect(dist(neutral.end, left.end)).toBeGreaterThan(0.4);
  });

  it('moves one diamond on a straight long-rail rebound with half-maximum spin', () => {
    const start = vec(25, 10);
    const crossTable = MAX_Y - MIN_Y;
    const oneDiamond = TABLE_W / 8;
    const reboundAngle = Math.atan(oneDiamond / crossTable);
    const travelToTopRail = MAX_Y - start.y;
    const travelBackToBottomRail = crossTable / Math.cos(reboundAngle);

    const right = tracePath(start, vec(0, 1), travelToTopRail + travelBackToBottomRail, [], {
      sidespin: 0.5,
    });
    const left = tracePath(start, vec(0, 1), travelToTopRail + travelBackToBottomRail, [], {
      sidespin: -0.5,
    });

    expect(right.end.y).toBeCloseTo(MIN_Y, 3);
    expect(left.end.y).toBeCloseTo(MIN_Y, 3);
    expect(right.end.x).toBeCloseTo(start.x + oneDiamond, 1);
    expect(left.end.x).toBeCloseTo(start.x - oneDiamond, 1);
  });

  it('prices half-maximum sidespin and adds rebound direction uncertainty', () => {
    const g = shotGeometry(vec(40, 10), vec(50, 25), pocketById('TS'))!;
    const travel = Math.max(30, minCueTravel(g, 'follow'));
    expect(sidespinReliability(0, INTERMEDIATE)).toBe(1);
    expect(sidespinReliability(0.5, INTERMEDIATE)).toBe(INTERMEDIATE.sidespinReliability);
    expect(routeEase(g, 'follow', 0.5, travel, 1, 20, INTERMEDIATE)).toBeLessThan(
      routeEase(g, 'follow', 0, travel, 1, 20, INTERMEDIATE),
    );
    expect(directionSigma('follow', 1, INTERMEDIATE, g.dCueGhost, undefined, false, 0.5))
      .toBeGreaterThan(directionSigma('follow', 1, INTERMEDIATE, g.dCueGhost));
  });

  it('does not assign sidespin to final-ball safety routes', () => {
    const route = finalSafetyRoute(vec(50, 8), vec(50, 25), INTERMEDIATE)!;
    expect(route.sidespin).toBe(0);
  });

  it('does not keep nonzero sidespin on no-rail planned routes', () => {
    const layout: Layout = {
      seed: 0,
      balls: [
        { num: 7, pos: vec(25, 35) },
        { num: 8, pos: vec(50, 15) },
        { num: 9, pos: vec(75, 35) },
      ],
    };
    const pattern = solve(layout, INTERMEDIATE)!;
    for (const shot of pattern.shots) {
      if (shot.rails === 0) expect(shot.sidespin).toBe(0);
    }
  });

  it('explains player-facing spin as left spin or right spin', () => {
    const shot: PlannedShot = {
      ball: { num: 7, pos: vec(50, 25) },
      pocket: pocketById('TS'),
      cuePos: vec(40, 10),
      ghost: vec(50, 22.75),
      cutDeg: 20,
      potProb: 0.9,
      type: 'follow',
      sidespin: 0.5,
      path: [vec(50, 22.75), vec(70, 22.75)],
      landing: vec(70, 22.75),
      rails: 1,
      travel: 30,
      eNext: 0.7,
      windowRef: 1,
      zoneLen: 20,
      entryDeg: 20,
      zone: null,
      explanation: '',
    };
    const next = { ...shot, ball: { num: 8, pos: vec(70, 25) }, sidespin: 0 as const };
    expect(explainShot(shot, next, false, INTERMEDIATE)).toContain('right spin');
    expect(explainShot({ ...shot, sidespin: -0.5 }, next, false, INTERMEDIATE))
      .toContain('left spin');
  });
});
