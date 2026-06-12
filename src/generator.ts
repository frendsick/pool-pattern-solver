// Solver-validated layout generation (see CONTEXT.md): rejection-sample
// object-ball positions, run the solver, and only accept layouts for which a
// complete Pattern exists with a reasonable Run-out Probability.

import { dist, vec, Vec } from './geometry';
import { Ball, Layout, MIN_X, MAX_X, MIN_Y, MAX_Y, POCKETS } from './table';
import { SkillProfile } from './skill';
import { solve, Pattern } from './solver';
import { ballPathToPocketClear } from './shots';

const CUSHION_MARGIN = 2.5;
const MIN_SEPARATION = 6;
const POCKET_MARGIN = 5;
// Acceptance bar as a per-shot quality so every ball count demands the same
// standard: a flat Run-out Probability floor would require ~0.79/shot at 9
// balls (rejecting nearly every layout) but only ~0.49/shot at 3.
const MIN_SCORE_PER_SHOT = 0.7;
const MAX_TRIES = 300;

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

function randomPositions(rng: () => number, n: number): Vec[] | null {
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 50 && !placed; attempt++) {
      const p = vec(
        MIN_X + CUSHION_MARGIN + rng() * (MAX_X - MIN_X - 2 * CUSHION_MARGIN),
        MIN_Y + CUSHION_MARGIN + rng() * (MAX_Y - MIN_Y - 2 * CUSHION_MARGIN),
      );
      if (out.some((q) => dist(p, q) < MIN_SEPARATION)) continue;
      if (POCKETS.some((pk) => dist(p, pk.target) < POCKET_MARGIN)) continue;
      out.push(p);
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
  const minScore = MIN_SCORE_PER_SHOT ** ballCount;

  let best: GeneratedPuzzle | null = null;
  for (let t = 0; t < MAX_TRIES; t++) {
    const positions = randomPositions(rng, ballCount);
    if (!positions) continue;
    const balls: Ball[] = numbers.map((num, i) => ({ num, pos: positions[i] }));
    if (!quickFeasible(balls)) continue;
    const layout: Layout = { balls, seed };
    const pattern = solve(layout, skill);
    if (!pattern) continue;
    if (pattern.score >= minScore) return { layout, pattern };
    if (!best || pattern.score > best.pattern.score) best = { layout, pattern };
  }
  return best; // fall back to the best sub-threshold layout rather than fail
}
