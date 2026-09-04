// Bundle first to measure the module shape used by the production worker:
// npx esbuild scripts/benchmark-generation.ts --bundle --platform=node --format=esm --outfile=/tmp/pps-bench.mjs
// node /tmp/pps-bench.mjs
// Override BENCH_SEED to compare another reproducible set of layouts.
import assert from 'node:assert/strict';
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';

const seed = Number(process.env.BENCH_SEED ?? 2024);
for (const ballCount of [3, 6, 9]) {
  const times: number[] = [];
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const puzzle = generatePuzzle(seed, ballCount, INTERMEDIATE);
    times.push(performance.now() - start);
    assert.equal(puzzle?.pattern.shots.length, ballCount);
  }
  times.sort((a, b) => a - b);
  console.log(`${ballCount} balls, seed ${seed}: ${times[1].toFixed(0)} ms median (3 runs)`);
}
