// Dump SVG snapshots of every step of a generated puzzle, for visual review.
// Usage: npx vite-node scripts/snapshot.ts   (snapshots land in /tmp/pps-snapshots)

import { writeFileSync, mkdirSync } from 'node:fs';
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { sceneForStep } from '../src/scene';
import { renderScene } from '../src/render';

const seed = Number(process.env.SNAPSHOT_SEED ?? 12345);
const puzzle = generatePuzzle(seed, 3, INTERMEDIATE)!;
mkdirSync('/tmp/pps-snapshots', { recursive: true });
const n = puzzle.pattern.shots.length;
// step 0 = bare layout, 1 = overview, 2..n+1 = shots
for (let s = 0; s <= n + 1; s++) {
  const svg = renderScene(sceneForStep(puzzle.layout, puzzle.pattern, s, INTERMEDIATE));
  writeFileSync(`/tmp/pps-snapshots/step${s}.svg`, svg);
}
for (let s = 0; s < n; s++) {
  console.log(`step ${s + 1}: ${puzzle.pattern.shots[s].explanation}`);
}
console.log(`score: ${puzzle.pattern.score.toFixed(3)}`);
