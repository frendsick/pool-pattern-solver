import { expect, it } from 'vitest';
import { generatePuzzle } from '../src/generator';
import { packPuzzle, unpackPuzzle } from '../src/generation';
import { sceneForStep } from '../src/scene';
import { INTERMEDIATE } from '../src/skill';
import { surfacesForLayout } from '../src/value';

it.each([2, 9])('preserves the complete %i-ball puzzle across the worker boundary', (ballCount) => {
  const original = generatePuzzle(2024, ballCount, INTERMEDIATE)!;
  expect(original).not.toBeNull();
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
