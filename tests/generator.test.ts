import { describe, it, expect } from 'vitest';
import { dist } from '../src/geometry';
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';

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
});
