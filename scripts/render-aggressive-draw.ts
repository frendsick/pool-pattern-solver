// Render the round-10 aggression feedback layout (image #23) through the
// full scene pipeline, for visual review: easy short 8 ball into the
// bottom-left, 9 far up-table — the cue ball should chase the 9 deep into
// the window (margin kept), not settle near the window's entry.

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
    { num: 8, pos: vec(24, 15) },
    { num: 9, pos: vec(82, 36) },
  ],
};

const pattern = solve(layout, INTERMEDIATE)!;
mkdirSync('/tmp/pps-snapshots', { recursive: true });
for (let s = 0; s <= pattern.shots.length + 1; s++) {
  const svg = renderScene(sceneForStep(layout, pattern, s, INTERMEDIATE));
  writeFileSync(`/tmp/pps-snapshots/ad-step${s}.svg`, svg);
}
for (const sh of pattern.shots) console.log(sh.explanation);
