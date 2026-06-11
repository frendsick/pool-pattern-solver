// Render the round-6 feedback layout (see repro-straight-power.ts) step by
// step into /tmp/pps-feedback6 for visual review.

import { writeFileSync, mkdirSync } from 'node:fs';
import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';
import { sceneForStep } from '../src/scene';
import { renderScene } from '../src/render';

const layout: Layout = {
  seed: 0,
  balls: [
    { num: 7, pos: vec(80.5, 31.6) },
    { num: 8, pos: vec(86.8, 5.5) },
    { num: 9, pos: vec(74.8, 12.9) },
  ],
};

const pattern = solve(layout, INTERMEDIATE)!;
mkdirSync('/tmp/pps-feedback6', { recursive: true });
const n = pattern.shots.length;
for (let s = 0; s <= n + 1; s++) {
  const svg = renderScene(sceneForStep(layout, pattern, s, INTERMEDIATE));
  writeFileSync(`/tmp/pps-feedback6/step${s}.svg`, svg);
}
console.log(`wrote ${n + 2} steps to /tmp/pps-feedback6`);
