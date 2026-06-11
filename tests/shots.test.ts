import { describe, it, expect } from 'vitest';
import { vec, add, scale, rotate, norm, sub } from '../src/geometry';
import { pocketById, BALL_R } from '../src/table';
import { shotGeometry, departureDir, minCueTravel, hitDistance, tracePath } from '../src/shots';

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

  it('a near-straight shot demands a monster hit for any real travel', () => {
    // straight follow keeps only (2/7)^2 ~ 8% of the hit's distance budget
    expect(hitDistance(gAt(0), 'follow', 40)).toBeCloseTo(40 / (4 / 49), 0);
    // the same sideways travel off a healthy angle is a normal stroke
    expect(hitDistance(gAt(40), 'follow', 40)).toBeLessThan(100);
    expect(hitDistance(gAt(5), 'follow', 40)).toBeGreaterThan(400);
  });

  it('scales linearly with the chosen travel', () => {
    const g = gAt(20);
    expect(hitDistance(g, 'stun', 60)).toBeCloseTo(2 * hitDistance(g, 'stun', 30), 6);
  });

  it('stop is not a powered route', () => {
    expect(hitDistance(gAt(0), 'stop', 0.5)).toBe(0);
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
