import { describe, it, expect } from 'vitest';
import { vec, sub, scale, segmentClearsCircle } from '../src/geometry';
import { BALL_R, POCKETS, TABLE_W, TABLE_H } from '../src/table';
import { shotGeometry, tracePath } from '../src/shots';
import { INTERMEDIATE, potProbability } from '../src/skill';
import { pocketRisk } from '../src/route';

describe('corner pocket mouth targets (issue #33)', () => {
  for (const pocket of POCKETS.filter((p) => !p.id.endsWith('S'))) {
    it(`${pocket.id}: clears both jaws on the shallow rail approach`, () => {
      // Mirror the reported TL shot into each corner.
      const mirror = (x: number, y: number) => vec(
        pocket.id.endsWith('L') ? x : TABLE_W - x,
        pocket.id.startsWith('T') ? y : TABLE_H - y,
      );
      const ball = mirror(56, 43);
      const cue = mirror(71, 40);
      const jawOffset = 4.5 / Math.SQRT2;
      const jaws = [mirror(jawOffset, TABLE_H), mirror(0, TABLE_H - jawOffset)];
      const oldTarget = mirror(0, TABLE_H);
      expect(segmentClearsCircle(ball, oldTarget, jaws[0], BALL_R)).toBe(false);

      const g = shotGeometry(cue, ball, pocket)!;
      expect(g).not.toBeNull();
      expect(potProbability(g, pocket, INTERMEDIATE)).toBeGreaterThan(0);
      for (const jaw of jaws) {
        expect(segmentClearsCircle(ball, pocket.target, jaw, BALL_R)).toBe(true);
      }
      const mouth = mirror(jawOffset / 2, TABLE_H - jawOffset / 2);
      expect(pocket.target.x).toBeCloseTo(mouth.x, 10);
      expect(pocket.target.y).toBeCloseTo(mouth.y, 10);
    });

    it(`${pocket.id}: keeps scratch capture separate from the aiming target`, () => {
      const start = sub(pocket.captureCenter, scale(pocket.facing, 10));
      const trace = tracePath(start, pocket.facing, 10, []);
      expect(trace.outcome).toBe('scratch');
      expect(trace.rails).toBe(0);
      // Cloth inside the capture disk is playable up to the cushion opening.
      expect(trace.travelled).toBeCloseTo(10 - Math.SQRT2 * BALL_R, 10);
      expect(pocketRisk(trace.points)).toBeLessThan(0.5);
      expect(pocketRisk([...trace.points].reverse())).toBe(1);

      // Four inches from the corner, the cue can hit the cushion below the jaw.
      const nearRail = vec(
        pocket.id.endsWith('L') ? 20 : TABLE_W - 20,
        pocket.id.startsWith('T') ? TABLE_H - 4 : 4,
      );
      const rebound = tracePath(nearRail, vec(pocket.id.endsWith('L') ? -1 : 1, 0), 22, []);
      expect(rebound.outcome).toBe('ok');
      expect(rebound.rails).toBe(1);
    });
  }
});
