// Render the round-8 natural-follow feedback layout (image #20/21) through
// the full scene pipeline, for visual review against the player's drawing.

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
    { num: 7, pos: vec(4.4, 27.9) },
    { num: 8, pos: vec(87.9, 17.0) },
    { num: 9, pos: vec(14.4, 15.0) },
  ],
};

const pattern = solve(layout, INTERMEDIATE)!;
mkdirSync('/tmp/pps-snapshots', { recursive: true });
for (let s = 0; s <= pattern.shots.length + 1; s++) {
  const svg = renderScene(sceneForStep(layout, pattern, s, INTERMEDIATE));
  writeFileSync(`/tmp/pps-snapshots/nf-step${s}.svg`, svg);
}
for (const sh of pattern.shots) console.log(sh.explanation);
