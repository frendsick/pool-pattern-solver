// Repro of the natural-angle follow feedback (2026-06-11, round 8):
// 7 near the left rail, 9 below it near the bottom-left side, 8 far
// down-table on the right. The player (ball in hand): place BELOW the 7 for
// a ~30 degree cut, NATURAL FOLLOW one rail to center table (the ~30 degree
// carom direction off a rolling ball is the easiest thing in pool to
// control), then a stun off the 8 two rails back toward the 9 along its
// pocket line. The solver instead chose a long power route to the 8.

import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';

// Image #20 px -> inches: play field x 85..1557 px, y 75..810 px (y flipped).
const layout: Layout = {
  seed: 0,
  balls: [
    { num: 7, pos: vec(4.4, 27.9) },
    { num: 8, pos: vec(87.9, 17.0) },
    { num: 9, pos: vec(14.4, 15.0) },
  ],
};

const pattern = solve(layout, INTERMEDIATE);
if (!pattern) {
  console.log('NO PATTERN FOUND');
} else {
  for (const s of pattern.shots) {
    console.log(s.explanation);
    if (s.landing) {
      console.log(
        `   cue (${s.cuePos.x.toFixed(1)}, ${s.cuePos.y.toFixed(1)})` +
          ` -> landing (${s.landing.x.toFixed(1)}, ${s.landing.y.toFixed(1)})` +
          ` travel ${s.travel.toFixed(0)}" rails ${s.rails}`,
      );
    }
  }
  console.log(`score: ${pattern.score.toFixed(3)}`);
}
