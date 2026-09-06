// Solver-validated layout generation (see CONTEXT.md): rejection-sample
// object-ball positions, run the solver, and only accept layouts for which a
// complete Pattern exists with a reasonable Run-out Probability.

import { dist, vec, Vec } from './geometry';
import { Ball, FOOT_SPOT, Layout, MIN_X, MAX_X, MIN_Y, MAX_Y, POCKETS } from './table';
import { SkillProfile } from './skill';
import { solve, screenLayout, Pattern } from './solver';
import { ballPathToPocketClear } from './shots';

const CUSHION_MARGIN = 2.5;
const MIN_SEPARATION = 6;
const POCKET_MARGIN = 5;
// The 9 racks in the diamond's center and, on most breaks, isn't cleanly
// contacted — so it tends to rest on or near the foot spot. Bias it there most
// of the time; otherwise (a break that caught it) fall back to uniform.
const NINE_SPOT_BIAS = 0.75;
const NINE_SPOT_RADIUS = 6;
// Acceptance bar as a per-shot quality so every ball count demands the same
// standard: a flat Run-out Probability floor would require ~0.79/shot at 9
// balls (rejecting nearly every layout) but only ~0.49/shot at 3.
const MIN_SCORE_PER_SHOT = 0.7;
const MAX_TRIES = 300;
const SCREEN_MIN_BALLS = 6;
const SCREEN_BATCH_SIZE = 8;

/** Deterministic PRNG so layouts are reproducible from their seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleUniform(rng: () => number): Vec {
  return vec(
    MIN_X + CUSHION_MARGIN + rng() * (MAX_X - MIN_X - 2 * CUSHION_MARGIN),
    MIN_Y + CUSHION_MARGIN + rng() * (MAX_Y - MIN_Y - 2 * CUSHION_MARGIN),
  );
}

/** Uniform point in the near-spot disc around the foot spot. */
function sampleNearSpot(rng: () => number): Vec {
  const r = NINE_SPOT_RADIUS * Math.sqrt(rng());
  const a = 2 * Math.PI * rng();
  return vec(FOOT_SPOT.x + r * Math.cos(a), FOOT_SPOT.y + r * Math.sin(a));
}

// `nineIndex` is placed first (its near-spot disc starts empty, so the bias
// rarely fails to seat) and the rest scatter around it.
function randomPositions(rng: () => number, n: number, nineIndex: number): Vec[] | null {
  const out = new Array<Vec>(n);
  const order = [nineIndex, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== nineIndex)];
  for (const i of order) {
    const biasNine = i === nineIndex && rng() < NINE_SPOT_BIAS;
    let placed = false;
    for (let attempt = 0; attempt < 50 && !placed; attempt++) {
      const p = biasNine ? sampleNearSpot(rng) : sampleUniform(rng);
      if (out.some((q) => q && dist(p, q) < MIN_SEPARATION)) continue;
      if (POCKETS.some((pk) => dist(p, pk.target) < POCKET_MARGIN)) continue;
      out[i] = p;
      placed = true;
    }
    if (!placed) return null;
  }
  return out;
}

/** Cheap pre-check: each ball, at its turn, has some clear line to a pocket. */
function quickFeasible(balls: Ball[]): boolean {
  for (let i = 0; i < balls.length; i++) {
    const later = balls.slice(i + 1).map((b) => b.pos);
    const ok = POCKETS.some((p) => ballPathToPocketClear(balls[i].pos, p, later));
    if (!ok) return false;
  }
  return true;
}

export interface GeneratedPuzzle {
  layout: Layout;
  pattern: Pattern;
}

export function generatePuzzle(
  seed: number,
  ballCount: number,
  skill: SkillProfile,
): GeneratedPuzzle | null {
  const rng = mulberry32(seed);
  // With N balls left in 9-ball, the remaining numbers are (10-N)..9.
  const numbers = Array.from({ length: ballCount }, (_, i) => 10 - ballCount + i);
  const nineIndex = numbers.indexOf(9);
  const minScore = MIN_SCORE_PER_SHOT ** ballCount;

  let best: GeneratedPuzzle | null = null;
  const batchSize = ballCount >= SCREEN_MIN_BALLS ? SCREEN_BATCH_SIZE : 1;
  for (let tries = 0; tries < MAX_TRIES;) {
    const batch: { layout: Layout; estimate: number }[] = [];
    while (batch.length < batchSize && tries < MAX_TRIES) {
      tries++;
      const positions = randomPositions(rng, ballCount, nineIndex);
      if (!positions) continue;
      const balls: Ball[] = numbers.map((num, i) => ({ num, pos: positions[i] }));
      if (!quickFeasible(balls)) continue;
      const layout: Layout = { balls, seed };
      batch.push({ layout, estimate: batchSize > 1 ? screenLayout(layout, skill) : 0 });
    }
    // Screening changes order only. A weak estimate cannot discard a layout.
    batch.sort((a, b) => b.estimate - a.estimate);
    for (const { layout } of batch) {
      const pattern = solve(layout, skill, best?.pattern.score ?? 0);
      if (!pattern) continue;
      if (pattern.score >= minScore) return { layout, pattern };
      if (!best || pattern.score > best.pattern.score) best = { layout, pattern };
    }
  }
  return best; // fall back to the best sub-threshold layout rather than fail
}
