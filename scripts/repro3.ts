// Repro of the third annotated screenshot: solver chose a long straight draw
// where natural follow patterns exist (user's images 11/12).
import { writeFileSync, mkdirSync } from 'node:fs';
import { Layout } from '../src/table';
import { vec } from '../src/geometry';
import { solve } from '../src/solver';
import { INTERMEDIATE } from '../src/skill';
import { sceneForStep } from '../src/scene';
import { renderScene } from '../src/render';

const layout: Layout = {
  balls: [
    { num: 7, pos: vec(61.7, 7.2) },
    { num: 8, pos: vec(5.9, 44.1) },
    { num: 9, pos: vec(23.8, 13.7) },
  ],
  seed: 0,
};
const pattern = solve(layout, INTERMEDIATE)!;
mkdirSync('/tmp/pps-repro3', { recursive: true });
for (let s = 0; s <= pattern.shots.length + 1; s++) {
  const svg = renderScene(sceneForStep(layout, pattern, s, INTERMEDIATE));
  writeFileSync(`/tmp/pps-repro3/step${s}.svg`, svg);
}
for (const sh of pattern.shots) console.log(sh.explanation);
console.log('score:', pattern.score.toFixed(3));
