import { describe, it, expect } from 'vitest';
import { dist } from '../src/geometry';
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';
import { packPuzzle } from '../src/generation';

describe('solver-validated generator', () => {
  it('produces a runnable, well-separated 3-ball layout', () => {
    const puzzle = generatePuzzle(12345, 3, INTERMEDIATE);
    expect(puzzle).not.toBeNull();
    const { layout, pattern } = puzzle!;
    expect(layout.balls.map((b) => b.num)).toEqual([7, 8, 9]);
    expect(pattern.score).toBeGreaterThan(0.1);
    for (let i = 0; i < layout.balls.length; i++) {
      for (let j = i + 1; j < layout.balls.length; j++) {
        expect(dist(layout.balls[i].pos, layout.balls[j].pos)).toBeGreaterThanOrEqual(6);
      }
    }
  }, 60000);

  it('is reproducible from the seed', () => {
    const a = generatePuzzle(777, 3, INTERMEDIATE)!;
    const b = generatePuzzle(777, 3, INTERMEDIATE)!;
    expect(a.layout.balls).toEqual(b.layout.balls);
    expect(a.pattern.score).toBeCloseTo(b.pattern.score, 10);
  }, 120000);

  it('respects the configurable ball count', () => {
    const puzzle = generatePuzzle(2024, 4, INTERMEDIATE);
    expect(puzzle).not.toBeNull();
    expect(puzzle!.layout.balls.map((b) => b.num)).toEqual([6, 7, 8, 9]);
    expect(puzzle!.pattern.shots).toHaveLength(4);
  }, 120000);

  it('returns a full-solve pattern after screening a six-ball batch', () => {
    const puzzle = generatePuzzle(2024, 6, INTERMEDIATE)!;
    expect(puzzle).not.toBeNull();
    expect(puzzle.pattern.shots).toHaveLength(6);
    expect(puzzle.pattern.score).toBeGreaterThanOrEqual(0.7 ** 6);
    // A fresh layout bypasses the cache, so coarse screening grids cannot hide here.
    const freshLayout = { ...puzzle.layout };
    const full = solve(freshLayout, INTERMEDIATE)!;
    expect(packPuzzle(puzzle, INTERMEDIATE)).toEqual(
      packPuzzle({ layout: freshLayout, pattern: full }, INTERMEDIATE),
    );
  }, 120000);

  it('keeps a continuation that crosses the score floor through rounded quadrature weights', () => {
    const zeros = { stop: 0, follow: 0, stun: 0, lowTouch: 0, draw: 0 };
    const ones = { stop: 1, follow: 1, stun: 1, lowTouch: 1, draw: 1 };
    const skill = { ...INTERMEDIATE, aimSigma: 0, throwSigma: 0,
      speedSigma: zeros, speedSigmaFloor: zeros, dirSigma: zeros, typeReliability: ones,
      stopDrift: 0, railNoise: 0, railDirSigma: 0, sidespinRailDirSigma: 0,
      sidespinReliability: 1, straightFollowMultiRailReliability: 1 };
    const layout = { seed: 0, balls: [25, 50, 75].map((x, i) => ({
      num: i + 7, pos: { x, y: 25 },
    })) };
    const full = solve(layout, skill)!;
    expect(full).not.toBeNull();
    expect(solve(layout, skill, full.score * 0.999999)?.score).toBe(full.score);
    expect(solve(layout, skill, full.score * 1.01)).toBeNull();
  }, 30000);
});
