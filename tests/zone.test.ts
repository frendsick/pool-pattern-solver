import { describe, it, expect } from 'vitest';
import { vec, add, scale, rotate } from '../src/geometry';
import { pocketById, POCKETS, BALL_R, TABLE_W, TABLE_H } from '../src/table';
import { zoneContext, zoneValue, zonePolygons, railAway, railExcluded, RAIL_MARGIN } from '../src/zone';
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
    expect(zonePolygons(zc, INTERMEDIATE)).toHaveLength(0);
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
    const poly = zonePolygons(zc, INTERMEDIATE).flat();
    expect(poly.length).toBeGreaterThan(10);
    // every vertex below the ball (the shooting side for a top-side pot)
    for (const p of poly) expect(p.y).toBeLessThan(ball.y);
  });

  it('keeps the drawn zone out of the rail band where the shot cues away from the rail', () => {
    // Pot straight up the table: every band position cues toward center.
    const zc = zoneContext(ball, ts, []);
    const poly = zonePolygons(zc, INTERMEDIATE).flat();
    const minRail = (p: { x: number; y: number }) =>
      Math.min(p.x - BALL_R, TABLE_W - BALL_R - p.x, p.y - BALL_R, TABLE_H - BALL_R - p.y);
    for (const p of poly) expect(minRail(p)).toBeGreaterThanOrEqual(RAIL_MARGIN - 1e-6);
  });

  it('a cue ball near a rail is fine when the shot runs along that rail', () => {
    // Ball near the bottom rail going to the bottom-right corner: the shot
    // from behind it is nearly rail-parallel, so band positions stay in.
    const railBall = vec(80, 3.5);
    const br = pocketById('BR');
    const zc = zoneContext(railBall, br, []);
    const inBand = vec(65, 4); // 2.9" off the cushion, cueing along it
    expect(railAway(inBand, vec(1, 0))).toBe(0);
    expect(railExcluded(inBand, vec(1, 0))).toBe(false);
    expect(zoneValue(inBand, zc, INTERMEDIATE)).toBeGreaterThan(0.3);
    const poly = zonePolygons(zc, INTERMEDIATE).flat();
    const minRail = (p: { x: number; y: number }) =>
      Math.min(p.x - BALL_R, TABLE_W - BALL_R - p.x, p.y - BALL_R, TABLE_H - BALL_R - p.y);
    expect(poly.some((p) => minRail(p) < RAIL_MARGIN)).toBe(true);
    // ...but cueing away from a near rail is awkward and band-excluded.
    expect(railExcluded(vec(65, 4), vec(0, 1))).toBe(true);
  });

  it('the drawn window never covers positions shadowed by another ball (image #25)', () => {
    // The 9 sits between the 8 and most of its window: the wedge of cue
    // positions it screens from the ghost ball must not be painted — the
    // pie has to split around the shadow instead of bridging across it.
    const eight = vec(41.6, 34.3);
    const nine = vec(36.6, 26.8);
    const zc = zoneContext(eight, ts, [nine]);
    const polys = zonePolygons(zc, INTERMEDIATE);
    expect(polys.length).toBeGreaterThan(1); // the shadow splits the window
    const inPoly = (p: { x: number; y: number }, poly: { x: number; y: number }[]) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
          inside = !inside;
        }
      }
      return inside;
    };
    for (let x = 0; x <= TABLE_W; x += 0.5) {
      for (let y = 0; y <= TABLE_H; y += 0.5) {
        const p = vec(x, y);
        if (!polys.some((poly) => inPoly(p, poly))) continue;
        expect(zoneValue(p, zc, INTERMEDIATE)).toBeGreaterThan(0);
      }
    }
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
