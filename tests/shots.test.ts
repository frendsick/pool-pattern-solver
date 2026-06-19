import { describe, it, expect } from 'vitest';
import { vec, add, scale, rotate, norm, sub } from '../src/geometry';
import { pocketById, BALL_R } from '../src/table';
import {
  shotGeometry,
  departureDir,
  minCueTravel,
  hitDistance,
  tracePath,
  caromCurve,
  caromLocus,
} from '../src/shots';
import { angleBetween, dot, dist } from '../src/geometry';

describe('shot geometry', () => {
  const ball = vec(50, 25);
  const ts = pocketById('TS'); // target (50, 50): aim straight up

  it('straight shot: ghost ball directly behind, cut 0', () => {
    const g = shotGeometry(vec(50, 10), ball, ts)!;
    expect(g.cut).toBeCloseTo(0, 5);
    expect(g.ghost.x).toBeCloseTo(50);
    expect(g.ghost.y).toBeCloseTo(25 - 2 * BALL_R);
  });

  it('placement at angle phi off the aim-back line gives cut = phi', () => {
    const aimBack = vec(0, -1);
    const ghost = add(ball, scale(aimBack, 2 * BALL_R));
    const c = add(ghost, scale(rotate(aimBack, Math.PI / 6), 20));
    const g = shotGeometry(c, ball, ts)!;
    expect((g.cut * 180) / Math.PI).toBeCloseTo(30, 3);
  });

  it('straight shot departures: follow forward, draw straight back, stun none', () => {
    const g = shotGeometry(vec(50, 10), ball, ts)!;
    const follow = departureDir(g, 'follow')!;
    expect(follow.x).toBeCloseTo(0);
    expect(follow.y).toBeCloseTo(1);
    const draw = departureDir(g, 'draw')!;
    expect(draw.y).toBeCloseTo(-1);
    expect(departureDir(g, 'stun')).toBeNull();
  });

  it('touch of low departs between the tangent line and full draw', () => {
    const aimBack = vec(0, -1);
    const ghost = add(ball, scale(aimBack, 2 * BALL_R));
    const c = add(ghost, scale(rotate(aimBack, Math.PI / 6), 20));
    const g = shotGeometry(c, ball, ts)!;
    const stun = departureDir(g, 'stun')!;
    const low = departureDir(g, 'lowTouch')!;
    const draw = departureDir(g, 'draw')!;
    // pulls back off the tangent (negative aim component), but less than draw
    expect(low.y).toBeLessThan(stun.y);
    expect(low.y).toBeGreaterThan(draw.y);
  });

  it('cut shot: stun departs along the tangent line', () => {
    const aimBack = vec(0, -1);
    const ghost = add(ball, scale(aimBack, 2 * BALL_R));
    const c = add(ghost, scale(rotate(aimBack, Math.PI / 6), 20));
    const g = shotGeometry(c, ball, ts)!;
    const stun = departureDir(g, 'stun')!;
    // tangent is perpendicular to the aim (0,1)
    expect(Math.abs(stun.y)).toBeLessThan(1e-6);
    // and points to the same side the cue ball came from
    const cueDir = norm(sub(g.ghost, c));
    expect(Math.sign(stun.x)).toBe(Math.sign(cueDir.x));
  });
});

describe('minCueTravel', () => {
  const ball = vec(50, 25);
  const ts = pocketById('TS'); // 25" from the ball

  const gAt = (cutDeg: number) => {
    const aimBack = vec(0, -1);
    const ghost = add(ball, scale(aimBack, 2 * BALL_R));
    const c = add(ghost, scale(rotate(aimBack, (cutDeg * Math.PI) / 180), 20));
    return shotGeometry(c, ball, ts)!;
  };

  it('a route cannot travel less than pocket pace leaves the cue ball', () => {
    // straight follow keeps (2/7)^2 of the object ball's pace share
    expect(minCueTravel(gAt(0), 'follow')).toBeGreaterThan(2);
    // bigger cuts keep more tangent speed
    expect(minCueTravel(gAt(30), 'stun')).toBeGreaterThan(minCueTravel(gAt(10), 'stun'));
    // a touch of low keeps less than full draw
    expect(minCueTravel(gAt(20), 'lowTouch')).toBeLessThan(minCueTravel(gAt(20), 'draw'));
    // the stop shot is the firm exception
    expect(minCueTravel(gAt(0), 'stop')).toBe(0);
  });
});

describe('hitDistance', () => {
  const ball = vec(50, 25);
  const ts = pocketById('TS');

  const gAt = (cutDeg: number) => {
    const aimBack = vec(0, -1);
    const ghost = add(ball, scale(aimBack, 2 * BALL_R));
    const c = add(ghost, scale(rotate(aimBack, (cutDeg * Math.PI) / 180), 20));
    return shotGeometry(c, ball, ts)!;
  };

  it('straight follow is a controlled top-spin stroke; near-straight sideways stun is not', () => {
    // Straight follow can be powered through the roll component: this is a
    // routine top-spin stroke, not the same as trying to move sideways.
    expect(hitDistance(gAt(0), 'follow', 40)).toBeCloseTo(40 / (2 / 7), 0);
    expect(hitDistance(gAt(5), 'follow', 40)).toBeLessThan(160);
    // The same travel off a healthy angle is also a normal stroke.
    expect(hitDistance(gAt(40), 'follow', 40)).toBeLessThan(100);
    // But near-straight tangent/stun movement is still a monster.
    expect(hitDistance(gAt(5), 'stun', 40)).toBeGreaterThan(400);
  });

  it('scales linearly with the chosen travel', () => {
    const g = gAt(20);
    expect(hitDistance(g, 'stun', 60)).toBeCloseTo(2 * hitDistance(g, 'stun', 30), 6);
  });

  it('stop is not a powered route', () => {
    expect(hitDistance(gAt(0), 'stop', 0.5)).toBe(0);
  });
});

describe('carom curve (30-degree rule trajectory)', () => {
  const ball = vec(50, 25);
  const ts = pocketById('TS');

  const gAt = (cutDeg: number) => {
    const aimBack = vec(0, -1);
    const ghost = add(ball, scale(aimBack, 2 * BALL_R));
    const c = add(ghost, scale(rotate(aimBack, (cutDeg * Math.PI) / 180), 20));
    return shotGeometry(c, ball, ts)!;
  };

  it('a rolling follow departs along the tangent line, not the carom line', () => {
    const g = gAt(30);
    const cv = caromCurve(g, 'follow', 40)!;
    const first = norm(cv.offsets[0]);
    // first slide step hugs the tangent...
    expect(angleBetween(first, g.tangent)).toBeLessThan(0.06);
    // ...which is well off the final carom line (~26° here)
    expect(angleBetween(first, departureDir(g, 'follow')!)).toBeGreaterThan(0.35);
  });

  it('the slide parabola feeds into the departureDir carom line', () => {
    const g = gAt(30);
    const cv = caromCurve(g, 'follow', 40)!;
    const n = cv.offsets.length;
    const lastSeg = norm(sub(cv.offsets[n - 1], cv.offsets[n - 2]));
    expect(angleBetween(lastSeg, departureDir(g, 'follow')!)).toBeLessThan(0.06);
  });

  it('the slide is a small, travel-proportional share of the path', () => {
    const g = gAt(30);
    const short = caromCurve(g, 'follow', 30)!;
    const long = caromCurve(g, 'follow', 90)!;
    expect(short.arc / 30).toBeGreaterThan(0.01);
    expect(short.arc / 30).toBeLessThan(0.15);
    // speed-invariant shape: the curve scales linearly with travel
    expect(long.arc / short.arc).toBeCloseTo(3, 6);
  });

  it('draw hooks back behind the tangent line', () => {
    const g = gAt(30);
    const cv = caromCurve(g, 'draw', 40)!;
    const end = cv.offsets[cv.offsets.length - 1];
    expect(dot(end, g.aim)).toBeLessThan(0);
    // and the slide is a bigger share than follow's: more slip to burn
    expect(cv.arc).toBeGreaterThan(caromCurve(g, 'follow', 40)!.arc);
  });

  it('stop, stun and near-straight shots have no curve', () => {
    expect(caromCurve(gAt(30), 'stop', 40)).toBeNull();
    expect(caromCurve(gAt(30), 'stun', 40)).toBeNull();
    expect(caromCurve(gAt(0.5), 'follow', 40)).toBeNull();
  });

  it('tracePath lands curved routes on the landing locus', () => {
    const g = gAt(30);
    for (const type of ['follow', 'lowTouch', 'draw'] as const) {
      const locus = caromLocus(g, type)!;
      expect(locus.eta).toBeGreaterThan(0.97);
      expect(locus.eta).toBeLessThanOrEqual(1);
      for (const travel of [20, 40]) {
        const cv = caromCurve(g, type, travel)!;
        const tr = tracePath(g.ghost, departureDir(g, type)!, travel, [], {
          maxRails: 4,
          curve: cv,
        });
        const expected = add(g.ghost, scale(locus.dir, locus.eta * travel));
        expect(tr.rails).toBe(0);
        expect(dist(tr.end, expected)).toBeLessThan(0.05);
      }
    }
  });
});

describe('tracePath', () => {
  it('reflects mirror-style off a cushion', () => {
    const tr = tracePath(vec(50, 25), vec(1, 0), 60, []);
    expect(tr.rails).toBe(1);
    expect(tr.end.x).toBeCloseTo(2 * 98.875 - 110, 1); // 87.75
    expect(tr.end.y).toBeCloseTo(25);
    expect(tr.outcome).toBe('ok');
  });

  it('detects a scratch into a corner pocket', () => {
    const tr = tracePath(vec(90, 10), norm(vec(1, -1)), 40, []);
    expect(tr.outcome).toBe('scratch');
  });

  it('stops on contact with an obstacle ball', () => {
    const tr = tracePath(vec(50, 25), vec(1, 0), 60, [vec(70, 25)]);
    expect(tr.outcome).toBe('ball');
    expect(tr.end.x).toBeCloseTo(70 - 2 * BALL_R, 1);
  });
});
