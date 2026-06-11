// One-off repro of the layout in the user's screenshot (hand-placed balls).
import { writeFileSync, mkdirSync } from 'node:fs';
import { Layout } from '../src/table';
import { vec } from '../src/geometry';
import { solve } from '../src/solver';
import { INTERMEDIATE } from '../src/skill';
import { sceneForStep } from '../src/scene';
import { renderScene } from '../src/render';

const layout: Layout = {
  balls: [
    { num: 7, pos: vec(51.2, 18.0) },
    { num: 8, pos: vec(29.5, 25.3) },
    { num: 9, pos: vec(41.9, 29.6) },
  ],
  seed: 0,
};
const pattern = solve(layout, INTERMEDIATE)!;
mkdirSync('/tmp/pps-repro', { recursive: true });
const n = pattern.shots.length;
for (let s = 0; s <= n + 1; s++) {
  const svg = renderScene(sceneForStep(layout, pattern, s, INTERMEDIATE));
  writeFileSync(`/tmp/pps-repro/step${s}.svg`, svg);
}
for (const sh of pattern.shots) console.log(sh.explanation);
console.log('score:', pattern.score.toFixed(3));
