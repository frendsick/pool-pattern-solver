// Bundle first to measure the module shape used by the production worker:
// npx esbuild scripts/benchmark-generation.ts --bundle --platform=node --format=esm --outfile=/tmp/pps-bench.mjs
// node /tmp/pps-bench.mjs
// Override BENCH_SEED, BENCH_BALLS (comma-separated), or BENCH_RUNS for focused comparisons.
import assert from 'node:assert/strict';
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';

const seed = Number(process.env.BENCH_SEED ?? 2024);
const runs = Number(process.env.BENCH_RUNS ?? 3);
const ballCounts = (process.env.BENCH_BALLS ?? '3,6,9').split(',').map(Number);
for (const ballCount of ballCounts) {
  const times: number[] = [];
  let score = 0;
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    const puzzle = generatePuzzle(seed, ballCount, INTERMEDIATE);
    times.push(performance.now() - start);
    assert.equal(puzzle?.pattern.shots.length, ballCount);
    score = puzzle!.pattern.score;
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`${ballCount} balls, seed ${seed}: ${median.toFixed(0)} ms median (${runs} runs), score ${score.toFixed(4)}`);
}
