// Distribution sanity sweep: shot types, cut angles and scores across many
// generated layouts. Guards the cut-ease changes (2026-06-12) against
// pathologies (everything-follow, sweet-spot tunnel vision, score collapse).

import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';

const types = new Map<string, number>();
const cuts: number[] = [];
let scoreSum = 0;
let n = 0;
for (let seed = 1; seed <= 60; seed++) {
  const puzzle = generatePuzzle(seed, 3, INTERMEDIATE);
  if (!puzzle) continue;
  n++;
  scoreSum += puzzle.pattern.score;
  for (const s of puzzle.pattern.shots) {
    cuts.push(s.cutDeg);
    if (s.type) types.set(s.type, (types.get(s.type) ?? 0) + 1);
  }
}
cuts.sort((a, b) => a - b);
const q = (p: number) => cuts[Math.floor(p * (cuts.length - 1))].toFixed(0);
console.log(`layouts: ${n}, mean score: ${(scoreSum / n).toFixed(3)}`);
console.log('route types:', [...types.entries()].map(([t, c]) => `${t} ${c}`).join(', '));
console.log(`cuts: p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} max ${q(1)} deg`);
console.log(`cuts > 35 deg: ${cuts.filter((c) => c > 35).length}/${cuts.length}`);
