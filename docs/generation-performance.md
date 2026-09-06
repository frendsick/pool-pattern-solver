# Generation latency investigation

Issue: [#39](https://github.com/frendsick/pool-pattern-solver/issues/39).

Measured on 2026-09-06. Baseline: `9b024104755619dd3667b62f3b3f8e817a1b4d60`.

Skipping redundant window scans during screening reduced nine-ball medians
by 13–23% in the fixed corpus. All accepted scores and pattern fingerprints
matched the baseline. The combined speedup from the pre-staging reference is
5.1×. The 10× target remains unmet.

## Measurement

The corpus uses seeds 2024, 777 and 12345 at three, six and nine balls, with
three consecutive runs per case. Each run calls `generatePuzzle` with a fresh
layout and `INTERMEDIATE`. Cases run serially in one Node process, without a
separate warm-up. No tests or other benchmarks run alongside the measurements.

Runtime: Node v24.14.1 on Linux 6.18.33.2-microsoft-standard-WSL2, x86-64,
AMD Ryzen 7 3700X. These are local Node bundle measurements. They do not
measure browser or mobile latency.

The benchmark records each duration, median, nearest-rank p95, screening and
full-solve counts, accepted score and a pattern fingerprint. With three runs,
p95 is the slowest observation. It is not a production tail-latency estimate.
Repeated counts, scores and fingerprints must match. Every result must contain
a complete pattern. Below-threshold fallbacks are reported separately.

```sh
npx esbuild scripts/benchmark-generation.ts --bundle --platform=node --format=esm --outfile=/tmp/pps-bench.mjs
node /tmp/pps-bench.mjs
BENCH_BALLS=9 BENCH_SEEDS=2024 BENCH_RUNS=3 node /tmp/pps-bench.mjs
```

`BENCH_SEED` remains supported for existing single-seed commands.
The baseline bundle used the same harness and optional counters, with its
solver and screening behavior unchanged.
Raw durations and fingerprints are in
[the baseline results](benchmarks/generation-39-baseline.jsonl).

## Baseline corpus

| Balls | Seed | Median s | p95 s | Screens | Full solves | Score |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 3 | 2024 | 1.260 | 1.556 | 0 | 1 | 0.746854 |
| 3 | 777 | 1.153 | 1.217 | 0 | 1 | 0.776651 |
| 3 | 12345 | 1.010 | 1.015 | 0 | 1 | 0.610768 |
| 6 | 2024 | 6.667 | 6.866 | 8 | 1 | 0.209042 |
| 6 | 777 | 5.683 | 5.717 | 8 | 1 | 0.238441 |
| 6 | 12345 | 5.579 | 5.682 | 8 | 1 | 0.418703 |
| 9 | 2024 | 9.226 | 9.375 | 8 | 1 | 0.050782 |
| 9 | 777 | 63.202 | 63.585 | 24 | 17 | 0.049865 |
| 9 | 12345 | 30.872 | 30.910 | 16 | 9 | 0.063467 |

## Profile and isolated trials

A separate CPU profile of nine balls at seed 2024 took 10.109 seconds.
Inclusive sampled CPU shares were 58.4% in screening, 33.1% in full solving,
30.2% in window-peak scans, 13.5% in exact curved-route sampling and 13.2% in
backward surface construction. Pot-pace calculations accounted for 23.1%,
including repeated pot-probability work. Garbage collection accounted for 7.7%.
Inclusive shares overlap and must not be added.

Each trial starts from the baseline, except the combined cache row. Unless
marked otherwise, timings are medians of three runs at nine balls, seed 2024.

| Trial | Seconds | Observation |
| --- | ---: | --- |
| Baseline | 9.226 | Eight screens and one full solve |
| Widen travel steps from unrailed distance spread | 8.594 | Score 0.050757, failed the established long-follow scenario |
| Cache minimum-pace pot probability by geometry and skill | 8.923 | Same score and fingerprint |
| Also check the existing carom cache before trigonometry | 8.831 | Same score and fingerprint |
| Cache fixed pot geometry and aim uncertainty | 8.860 | Same score and fingerprint |
| Refine screened strokes with one greedy continuation per shot | 10.301 | Two failed refinements, then the normal full solve |
| Validate the screened travel choices against full windows | 10.166 | One run. Both proposals failed on the opening follow |
| Screen with full grids and exact routes but a narrow beam | 21.204 | One run. Eight screens and two full solves |
| Remove window-peak scans from all route-target construction | 7.178 | Score 0.047427, changed full-search memo population |

The pot caches saved only about 3–4% on this case and add cache state. They
are not included. A screen-only score is still insufficient for acceptance.
The fixed-travel validation trial rejected opening follows of 13.851 and
30.110 inches under the full window checks. The greedy trial could lose a
later continuation after moving an earlier landing.

Deferring low screening estimates until the sampling budget was exhausted
also failed to provide a consistent gain. Single nine-ball runs for seeds
2024, 777 and 12345 took 13.557, 53.254 and 20.539 seconds. Full solves fell
to 2, 1 and 1, but screening rose to 8, 75 and 28 layouts. The latter two
scores were 0.083489 and 0.061031. This trades full searches for more screens
and delays layouts whose estimates are pessimistic. It is not included.

## Retained changes

Screening skips the full window-peak scan used only to filter route targets.
Route scoring still rejects unusable landings. Full search keeps the scan
because its sample order warms the quantized onward-control memo. A trial
combining full-search removal with rail-aware adaptive sampling failed the
full-rack score and short-route scenarios. Those failures were not isolated
further.

Adaptive travel sampling is not included. Even after accounting for cushion
braking, a wider step can skip a blocked or below-bar gap and join two usable
regions. The existing interval-length control factor would then enter the
accepted score with an inflated span. Exact endpoint and uncertainty traces
do not recompute that factor. A future adaptive trial must refine candidate
intervals at the base step before scoring, and check a deliberately skipped
dead gap. Fixed travel sampling and the current scoring calibration remain.

The acceptance threshold remains `0.7 ** ballCount`. Screening only changes
candidate order. Every accepted layout still runs the full beam search, and
generation still returns its best completed pattern when the sampling budget
ends below threshold. A changed screening order can change the selected layout
and accepted score. Screening estimates never discard a sampled layout.

## Final corpus

| Balls | Seed | Median s | p95 s | Screens | Full solves | Score |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 3 | 2024 | 1.136 | 1.465 | 0 | 1 | 0.746854 |
| 3 | 777 | 1.168 | 1.170 | 0 | 1 | 0.776651 |
| 3 | 12345 | 0.994 | 0.999 | 0 | 1 | 0.610768 |
| 6 | 2024 | 5.030 | 5.149 | 8 | 1 | 0.209042 |
| 6 | 777 | 4.453 | 4.466 | 8 | 1 | 0.238441 |
| 6 | 12345 | 4.633 | 4.671 | 8 | 1 | 0.418703 |
| 9 | 2024 | 7.069 | 7.168 | 8 | 1 | 0.050782 |
| 9 | 777 | 54.857 | 54.964 | 24 | 17 | 0.049865 |
| 9 | 12345 | 26.358 | 26.624 | 16 | 9 | 0.063467 |

All nine cases retained exactly the same accepted scores, pattern fingerprints,
screening counts and full-solve counts as the baseline. All results exceeded
the unchanged threshold, and all three repetitions were deterministic. Raw
samples are in [the final results](benchmarks/generation-39-final.jsonl).

Nine-ball medians improved by 23.4%, 13.2% and 14.6% for seeds 2024, 777 and
12345. Across the nine nine-ball observations, the median fell from 30.872 to
26.358 seconds and nearest-rank p95 from 63.585 to 54.964 seconds. This small,
fixed corpus does not establish a population p95. Three-ball generation does
not use screening, so its timing changes reflect runtime variance rather than
the optimization.

## Remaining gap to 10×

Seed 2024 still takes 7.069 seconds against the issue's roughly 3.5-second
target. It needs another 50.5% reduction. The tested changes do not establish
a complete 10× solution.

The measurements support this order for further work:

1. Reduce repeated full searches while preserving full-resolution window
   validation. Seed 777 still makes 16 full solves before the successful one,
   and seed 12345 makes eight. The tested one-pattern validators did not help
   seed 2024 because both coarse proposals failed their opening route's full
   window checks. Resolve that proposal/validation mismatch before attempting
   to accept a screened pattern.
2. Revisit adaptive discovery only with base-step refinement of candidate
   intervals before scoring. Exact curved sampling was 13.5% of baseline CPU
   time on seed 2024, so optimizing it alone cannot supply the remaining gain.
   Check both missed narrow windows and inflated spans across dead gaps.
3. Leave the tested geometry caches out unless a larger profile shows a
   stronger benefit. Their 3–4% isolated gains do not justify making them the
   main route toward 10×.

A final, separate CPU profile took 7.682 seconds, with 46.0% of samples in
screening and 46.2% in full solving. Window-peak scans fell to 5.1%, while
exact curved sampling accounted for 19.3% and backward grids for 17.5%.
Inclusive shares overlap. Removing the exact-sampling cost alone would leave
roughly 5.7 seconds of the measured 7.069-second median if other costs stayed
fixed. This is a cost estimate, not a demonstrated optimization.

The pre-staging implementation at `96681c7` was also measured on the same
runtime and hardware. Seed 2024 took 35.844 seconds median and 36.210 seconds
p95 across three runs, with eight full solves and the same score and
fingerprint. Raw samples are in
[the pre-staging results](benchmarks/generation-39-pre-staging.jsonl).
The combined improvement is 5.1×. A 10× result against this measured reference
would require about 3.584 seconds, or another 49.3% reduction from this change.

Validation: all 165 tests and the production build passed.
