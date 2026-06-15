import { describe, it, expect } from 'vitest';
import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { previewLegFromCue, solve, solveFromCue } from '../src/solver';
import { gateFor, surfacesForLayout } from '../src/value';

const layout: Layout = {
  seed: 0,
  balls: [
    { num: 7, pos: vec(25, 35) },
    { num: 8, pos: vec(50, 15) },
    { num: 9, pos: vec(75, 35) },
  ],
};

describe('fixed-cue continuation solver', () => {
  const pattern = solve(layout, INTERMEDIATE);
  if (!pattern) throw new Error('fixture failed to solve');

  it('re-solves a suffix from an exact mid-rack cue', () => {
    const startIndex = 1;
    const suffix = solveFromCue(layout, INTERMEDIATE, startIndex, pattern.shots[startIndex].cuePos);

    expect(suffix).not.toBeNull();
    expect(suffix!.shots.map((s) => s.ball.num)).toEqual([8, 9]);
    expect(suffix!.score).toBeGreaterThan(0);
    expect(suffix!.shots[0].zone).not.toBeNull();
  });

  it('builds a live single-leg preview to the already selected next window', () => {
    const shot = pattern.shots[0];
    if (!shot.zone) throw new Error('fixture has no next window');

    const preview = previewLegFromCue(layout, INTERMEDIATE, 0, shot.cuePos, shot.zone);

    expect(preview).not.toBeNull();
    expect(preview!.ball.num).toBe(7);
    expect(preview!.zone).toBe(shot.zone);
    expect(preview!.path?.length).toBeGreaterThan(1);
    expect(preview!.landing).not.toBeNull();
    expect(preview!.eNext).toBeGreaterThan(0);
  });

  it('preserves absolute backward-surface gates for mid-rack suffix zones', () => {
    const rack: Layout = {
      seed: 15,
      balls: (
        [
          [1, 37.8, 18.1], [2, 74.2, 8.1], [3, 84.4, 18.1],
          [4, 30, 7.6], [5, 36.2, 25.1], [6, 91.7, 14.6],
          [7, 57.4, 32.6], [8, 78.8, 37], [9, 10.9, 10.4],
        ] as const
      ).map(([num, x, y]) => ({ num, pos: vec(x, y) })),
    };
    const full = solve(rack, INTERMEDIATE);
    if (!full) throw new Error('rack fixture failed to solve');
    const surfaces = surfacesForLayout(rack, INTERMEDIATE);
    const suffix = solveFromCue(rack, INTERMEDIATE, 1, full.shots[1].cuePos, surfaces);

    expect(suffix).not.toBeNull();
    expect(suffix!.shots[0].ball.num).toBe(2);
    expect(suffix!.shots[0].zone!.nextValue).toBe(gateFor(surfaces, 3));
  });
});
