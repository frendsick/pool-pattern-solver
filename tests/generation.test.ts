import { expect, it } from 'vitest';
import { vec } from '../src/geometry';
import { packPuzzle, unpackPuzzle } from '../src/generation';
import { sceneForStep } from '../src/scene';
import { INTERMEDIATE } from '../src/skill';
import { surfacesForLayout } from '../src/value';
import { solve } from '../src/solver';

it.each([2, 9])('preserves the complete %i-ball puzzle across the worker boundary', (ballCount) => {
  // Use the known full-rack fixture so transport checks need only one solve.
  const balls = [
    [1, 37.8, 18.1], [2, 74.2, 8.1], [3, 84.4, 18.1], [4, 30, 7.6],
    [5, 36.2, 25.1], [6, 91.7, 14.6], [7, 57.4, 32.6], [8, 78.8, 37], [9, 10.9, 10.4],
  ].slice(-ballCount).map(([num, x, y]) => ({ num, pos: vec(x, y) }));
  const layout = { seed: 15, balls };
  const original = { layout, pattern: solve(layout, INTERMEDIATE)! };
  expect(original.pattern).not.toBeNull();
  const message = structuredClone(packPuzzle(original, INTERMEDIATE));
  const restored = unpackPuzzle(message, INTERMEDIATE);

  expect(restored.pattern.shots.map((shot) => shot.ball.num)).toEqual(
    Array.from({ length: ballCount }, (_, i) => 10 - ballCount + i),
  );
  expect(packPuzzle(restored, INTERMEDIATE)).toEqual(packPuzzle(original, INTERMEDIATE));
  // Later cue-placement solves must reuse the received grids, not rebuild them.
  expect(surfacesForLayout(restored.layout, INTERMEDIATE)[1]!.grid).toBe(message.surfaces[1]!.grid);
  for (const step of [0, 1, 3, ballCount + 1]) {
    expect(sceneForStep(restored.layout, restored.pattern, step, INTERMEDIATE)).toEqual(
      sceneForStep(original.layout, original.pattern, step, INTERMEDIATE),
    );
  }
});
