import { describe, it, expect } from 'vitest';
import { vec } from '../src/geometry';
import { MIN_X, MAX_X, MIN_Y, MAX_Y, POCKETS } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { zoneContext, zoneValue } from '../src/zone';
import { buildSurfaces, gateFor } from '../src/value';
import { solve } from '../src/solver';

// A spread-out 3-ball layout: 7 bottom-left, 8 mid-table, 9 up top.
const balls = [
  { num: 7, pos: vec(25, 12) },
  { num: 8, pos: vec(55, 25) },
  { num: 9, pos: vec(80, 40) },
];

describe('backward value surfaces', () => {
  const surfaces = buildSurfaces(balls, INTERMEDIATE);

  it('builds one surface per ball after the first, last ball pot-only', () => {
    expect(surfaces[0]).toBeNull();
    expect(surfaces[1]).not.toBeNull();
    expect(surfaces[2]).not.toBeNull();
    // The 9 sits in the open: pottable from somewhere near every pocket.
    expect(surfaces[2]!.peak).toBeGreaterThan(0.8);
  });

  it('normalizes each surface to its own peak', () => {
    for (const s of [surfaces[1]!, surfaces[2]!]) {
      let best = 0;
      for (let x = MIN_X; x <= MAX_X; x += 2) {
        for (let y = MIN_Y; y <= MAX_Y; y += 2) {
          best = Math.max(best, s.at(vec(x, y)));
        }
      }
      expect(best).toBeGreaterThan(0.95);
      expect(best).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('returns 0 off the table', () => {
    expect(surfaces[2]!.at(vec(MIN_X - 1, 25))).toBe(0);
    expect(surfaces[2]!.at(vec(50, MAX_Y + 1))).toBe(0);
  });

  it('the last-ball surface tracks the pot-only zone values', () => {
    const zones = POCKETS.map((p) => zoneContext(balls[2].pos, p, [])).filter(
      (z) => z.ballPathClear,
    );
    // Compare at a few interior spots: surface (normalized) vs exact best
    // pot-only value (raw) — equal up to normalization and grid error.
    for (const p of [vec(70, 30), vec(60, 42), vec(85, 20)]) {
      let exact = 0;
      for (const z of zones) exact = Math.max(exact, zoneValue(p, z, INTERMEDIATE));
      const approx = surfaces[2]!.at(p) * surfaces[2]!.peak;
      expect(Math.abs(approx - exact)).toBeLessThan(0.08);
    }
  });

  it('the chained gate only ever discounts, and bites somewhere', () => {
    const gate = gateFor(surfaces, 1)!;
    const obstacles = balls.slice(1).map((b) => b.pos);
    let bites = false;
    for (const pocket of POCKETS) {
      const plain = zoneContext(balls[0].pos, pocket, obstacles);
      const gated = zoneContext(balls[0].pos, pocket, obstacles, [], gate);
      if (!plain.ballPathClear) continue;
      for (let x = MIN_X; x <= MAX_X; x += 7) {
        for (let y = MIN_Y; y <= MAX_Y; y += 7) {
          const v = zoneValue(vec(x, y), plain, INTERMEDIATE);
          const g = zoneValue(vec(x, y), gated, INTERMEDIATE);
          expect(g).toBeLessThanOrEqual(v + 1e-9);
          if (v > 0.3 && g < 0.9 * v) bites = true;
        }
      }
    }
    expect(bites).toBe(true);
  });

  it('gateFor falls back to "no gate" out of range', () => {
    expect(gateFor(surfaces, 0)).toBeUndefined();
    expect(gateFor(surfaces, balls.length)).toBeUndefined();
  });
});

describe('full 9-ball rack', () => {
  // Fixture: generatePuzzle(seed 15, 9 balls) — baked in so the test pays
  // one solve (~0.5s), not a solver-validated generation run (~5s+).
  const rack = (
    [
      [1, 37.8, 18.1], [2, 74.2, 8.1], [3, 84.4, 18.1], [4, 30, 7.6],
      [5, 36.2, 25.1], [6, 91.7, 14.6], [7, 57.4, 32.6], [8, 78.8, 37],
      [9, 10.9, 10.4],
    ] as const
  ).map(([num, x, y]) => ({ num, pos: vec(x, y) }));

  it('solves a complete 9-ball pattern in forced order', () => {
    const pattern = solve({ seed: 15, balls: rack }, INTERMEDIATE);
    expect(pattern).not.toBeNull();
    expect(pattern!.shots.length).toBe(9);
    // Rail energy and pot speed compound over the full rack.
    expect(pattern!.score).toBeGreaterThan(0.04);
    expect(pattern!.shots.map((s) => s.ball.num)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
  });
});
