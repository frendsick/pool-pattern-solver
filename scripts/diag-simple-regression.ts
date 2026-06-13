// Feedback (seed 775832494, n=9): after potting the 1 the cue is already on
// the 2's line, so the opener should be a stop / short draw. clearanceRisk at
// its original 0.5 floor regressed it into a 38" one-rail follow, because a
// LATER shot's draw skims the 7 at ~0.2" and the 0.5 floor made that near-miss
// a 42% score cut — heavy enough that the beam re-routed the whole rack into
// follows to dodge it. This diag re-implements the penalty locally and prints,
// per chosen shot, the worst non-target ball it threads and where along the
// path the closest approach falls, so the over-reach is visible: a tiny graze
// on one shot should not be worth restructuring the pattern.

import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { dist, distPointSegment } from '../src/geometry';
import { BALL_R } from '../src/table';

const BLOCK_MARGIN = BALL_R;
const BLOCK_FLOOR = 0.93; // keep in sync with route.ts

const puzzle = generatePuzzle(775832494, 9, INTERMEDIATE);
if (!puzzle) {
  console.log('no puzzle');
} else {
  const { layout, pattern } = puzzle;
  console.log('seed', layout.seed, 'score', pattern.score.toFixed(4));

  pattern.shots.forEach((s, i) => {
    const path = s.path ?? [];
    const nextNum = pattern.shots[i + 1]?.ball.num;
    const later = layout.balls.filter((b) => b.num > s.ball.num && b.num !== nextNum);
    let pathLen = 0;
    for (let k = 0; k + 1 < path.length; k++) pathLen += dist(path[k], path[k + 1]);

    let factor = 1;
    let worst = '';
    for (const b of later) {
      let mind = Infinity;
      let sAtMin = 0;
      let acc = 0;
      for (let k = 0; k + 1 < path.length; k++) {
        const segLen = dist(path[k], path[k + 1]);
        const d = distPointSegment(b.pos, path[k], path[k + 1]);
        if (d < mind) {
          mind = d;
          sAtMin = acc + segLen / 2;
        }
        acc += segLen;
      }
      const gap = mind - 2 * BALL_R;
      if (gap < BLOCK_MARGIN) {
        const f = BLOCK_FLOOR + ((1 - BLOCK_FLOOR) * Math.max(0, gap)) / BLOCK_MARGIN;
        if (f < factor) {
          factor = f;
          const fromEnd = pathLen - sAtMin;
          worst = `ball ${b.num} gap=${gap.toFixed(2)}" ~${fromEnd.toFixed(1)}" before landing`;
        }
      }
    }
    console.log(
      `Shot ${i + 1}: pot ${s.ball.num}->${s.pocket.id} type=${s.type} travel=${s.travel?.toFixed(1)} rails=${s.rails} len=${pathLen.toFixed(1)}"  clearance=${factor.toFixed(3)}${worst ? '  <- ' + worst : ''}`,
    );
  });
}
