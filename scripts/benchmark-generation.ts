// Bundle first to measure the module shape used by the production worker:
// npx esbuild scripts/benchmark-generation.ts --bundle --platform=node --format=esm --outfile=/tmp/pps-bench.mjs
// node /tmp/pps-bench.mjs
// Override BENCH_SEEDS, BENCH_BALLS (comma-separated), or BENCH_RUNS for focused comparisons.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpus, release } from 'node:os';
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';

const seeds = (process.env.BENCH_SEEDS ?? process.env.BENCH_SEED ?? '2024,777,12345').split(',').map(Number);
const runs = Number(process.env.BENCH_RUNS ?? 3);
const ballCounts = (process.env.BENCH_BALLS ?? '3,6,9').split(',').map(Number);
assert(Number.isInteger(runs) && runs > 0);
assert(seeds.every(Number.isSafeInteger));
assert(ballCounts.every(n => Number.isInteger(n) && n >= 1 && n <= 9));
console.log(JSON.stringify({ runtime: process.version, platform: process.platform,
  release: release(), cpu: cpus()[0].model, seeds, ballCounts, runs }));
for (const ballCount of ballCounts) {
  for (const seed of seeds) {
    const times: number[] = [];
    let expected: string | undefined;
    let result;
    for (let run = 0; run < runs; run++) {
      const stats = { screens: 0, fullSolves: 0 };
      const start = performance.now();
      const puzzle = generatePuzzle(seed, ballCount, INTERMEDIATE, stats);
      times.push(performance.now() - start);
      assert(puzzle);
      assert.equal(puzzle.pattern.shots.length, ballCount);
      assert(Number.isFinite(puzzle.pattern.score));
      assert(puzzle.pattern.shots.every(shot => shot.type && shot.path?.length && shot.landing));
      const fingerprint = createHash('sha256').update(JSON.stringify({
        balls: puzzle.layout.balls,
        score: puzzle.pattern.score,
        shots: puzzle.pattern.shots.map(({ zone, ...shot }) => shot),
      })).digest('hex').slice(0, 16);
      result = { ballCount, seed, ...stats, score: puzzle.pattern.score,
        threshold: 0.7 ** ballCount, fallback: puzzle.pattern.score < 0.7 ** ballCount, fingerprint };
      const deterministic = JSON.stringify(result);
      if (expected !== undefined) assert.equal(deterministic, expected);
      expected = deterministic;
    }
    times.sort((a, b) => a - b);
    const middle = Math.floor(times.length / 2);
    const medianMs = runs % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
    console.log(JSON.stringify({ ...result, medianMs, p95Ms: times[Math.ceil(runs * 0.95) - 1], times }));
  }
}
