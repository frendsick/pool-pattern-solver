import { describe, it, expect } from 'vitest';
import { vec, add, scale, rotate } from '../src/geometry';
import { pocketById, POCKETS, BALL_R, TABLE_W, TABLE_H } from '../src/table';
import { zoneContext, zoneValue, zonePolygon, RAIL_MARGIN } from '../src/zone';
import { shotGeometry, departureDir, ShotType } from '../src/shots';
import { INTERMEDIATE } from '../src/skill';

describe('position zone', () => {
  const ball = vec(50, 25);
  const ts = pocketById('TS');

  it('open shot has positive value; blocked cue path has zero', () => {
    const open = zoneContext(ball, ts, []);
    expect(zoneValue(vec(50, 10), open, INTERMEDIATE)).toBeGreaterThan(0.3);

    const blocked = zoneContext(ball, ts, [vec(50, 15)]);
    expect(zoneValue(vec(50, 10), blocked, INTERMEDIATE)).toBe(0);
  });

  it('zero when the ball-to-pocket line is blocked', () => {
    const zc = zoneContext(ball, ts, [vec(50, 35)]);
    expect(zoneValue(vec(50, 10), zc, INTERMEDIATE)).toBe(0);
    expect(zonePolygon(zc, INTERMEDIATE)).toHaveLength(0);
  });

  it('zero on the wrong side (no shot past max cut)', () => {
    const zc = zoneContext(ball, ts, []);
    expect(zoneValue(vec(50, 40), zc, INTERMEDIATE)).toBe(0);
  });

  it('finishing on top of the ball is infeasible; close is devalued', () => {
    const zc = zoneContext(ball, ts, []);
    expect(zoneValue(vec(50, 22), zc, INTERMEDIATE)).toBe(0); // 3" away
    const cramped = zoneValue(vec(50, 18), zc, INTERMEDIATE); // 7" away
    const comfortable = zoneValue(vec(50, 10), zc, INTERMEDIATE); // 15" away
    expect(cramped).toBeGreaterThan(0);
    expect(cramped).toBeLessThan(comfortable);
  });

  it('builds a pie polygon for an open zone', () => {
    const zc = zoneContext(ball, ts, []);
    const poly = zonePolygon(zc, INTERMEDIATE);
    expect(poly.length).toBeGreaterThan(10);
    // every vertex below the ball (the shooting side for a top-side pot)
    for (const p of poly) expect(p.y).toBeLessThan(ball.y);
  });

  it('keeps the drawn zone out of the 20 cm rail band when open elsewhere', () => {
    const zc = zoneContext(ball, ts, []);
    const poly = zonePolygon(zc, INTERMEDIATE);
    const minRail = (p: { x: number; y: number }) =>
      Math.min(p.x - BALL_R, TABLE_W - BALL_R - p.x, p.y - BALL_R, TABLE_H - BALL_R - p.y);
    for (const p of poly) expect(minRail(p)).toBeGreaterThanOrEqual(RAIL_MARGIN - 1e-6);
  });

  it('with a next ball, positions whose every exit is blocked drop to zero', () => {
    // 30° cut on the ball into the top side: cue down-right of the ghost.
    const aimBack = vec(0, -1);
    const ghost = add(ball, scale(aimBack, 2 * BALL_R));
    const cue = add(ghost, scale(rotate(aimBack, Math.PI / 6), 20));
    const nextBall = vec(80, 40);
    const nextZones = POCKETS.map((p) => zoneContext(nextBall, p, [])).filter(
      (z) => z.ballPathClear,
    );

    // Open exits: the value with a next ball stays positive.
    const open = zoneContext(ball, ts, [], nextZones);
    expect(zoneValue(cue, open, INTERMEDIATE)).toBeGreaterThan(0.2);

    // Wall off every departure line 6" past the ghost ball: no onward
    // position is reachable, so the spot is worthless despite an easy pot.
    const g = shotGeometry(cue, ball, ts)!;
    const blockers = (['follow', 'stun', 'draw'] as ShotType[]).map((t) =>
      add(ghost, scale(departureDir(g, t)!, 6)),
    );
    const walled = zoneContext(ball, ts, blockers, nextZones);
    expect(zoneValue(cue, walled, INTERMEDIATE)).toBe(0);
    // sanity: the pot itself is still on with the same obstacles
    const noNext = zoneContext(ball, ts, blockers);
    expect(zoneValue(cue, noNext, INTERMEDIATE)).toBeGreaterThan(0.2);
  });
});
