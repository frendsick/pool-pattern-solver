// Repro of the two pocket-priority feedback screenshots (2026-06-11):
// the solver should send balls sitting near a side pocket INTO that side
// pocket and shape the previous shot (leave an angle / draw) to get there.

import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';

// Image #14: 7 upper right-center, 8 near the top rail, 9 right next to the
// bottom side pocket. The player: 7 into the top side, then DRAW off the 8
// so the cue ball comes back down-table for the 9 into the bottom side.
const layout: Layout = {
  seed: 0,
  balls: [
    { num: 7, pos: vec(57.5, 38.3) },
    { num: 8, pos: vec(35.9, 43.3) },
    { num: 9, pos: vec(55.1, 7.5) },
  ],
};

const pattern = solve(layout, INTERMEDIATE);
if (!pattern) {
  console.log('NO PATTERN FOUND');
} else {
  for (const s of pattern.shots) console.log(s.explanation);
  console.log(`score: ${pattern.score.toFixed(3)}`);
}
