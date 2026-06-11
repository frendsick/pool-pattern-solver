// Round-7 second pro example (Image #19): pot a ball into the top-left
// corner and send the cue ball top rail -> across the table -> off the RIGHT
// rail, so the extra cushion behind the window guarantees position on the
// ball waiting near that rail. The solver should use a rail behind the
// window rather than trying to stop dead in it from across the table.

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
    { num: 8, pos: vec(13, 45.5) },
    { num: 9, pos: vec(92, 20) },
  ],
};

const pattern = solve(layout, INTERMEDIATE);
if (!pattern) {
  console.log('NO PATTERN FOUND');
} else {
  for (const s of pattern.shots) console.log(s.explanation);
  const first = pattern.shots[0];
  console.log(`route rails: ${first.rails}, travel ${first.travel.toFixed(0)}″, landing (${first.landing?.x.toFixed(1)}, ${first.landing?.y.toFixed(1)})`);
  console.log(`score: ${pattern.score.toFixed(3)}`);
  mkdirSync('/tmp/pps-extra-rail', { recursive: true });
  const n = pattern.shots.length;
  for (let s = 0; s <= n + 1; s++) {
    const svg = renderScene(sceneForStep(layout, pattern, s, INTERMEDIATE));
    writeFileSync(`/tmp/pps-extra-rail/step${s}.svg`, svg);
  }
}
