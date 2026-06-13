// Feedback (seed 1147167, n=4): the 6->7 position route runs the cue ball on
// a path that is blocked by the 9 for most of its travel. The user would
// instead keep the cue ball in the middle and play a safer simple route. Show
// what the solver actually picked, and how close every cue-ball leg passes to
// each remaining object ball, so we can see whether the chosen route threads a
// narrow gap past the 9.

import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { dist, distPointSegment } from '../src/geometry';

const puzzle = generatePuzzle(1147167, 4, INTERMEDIATE);
if (!puzzle) {
  console.log('no puzzle');
} else {
  const { layout, pattern } = puzzle;
  console.log('seed', layout.seed, 'score', pattern.score.toFixed(4));
  console.log('balls:');
  for (const b of layout.balls) console.log(`  ${b.num}: (${b.pos.x.toFixed(1)}, ${b.pos.y.toFixed(1)})`);
  console.log('');

  pattern.shots.forEach((s, i) => {
    console.log(
      `Shot ${i + 1}: ${s.ball.num}->${s.pocket.id}  type=${s.type} travel=${s.travel?.toFixed(1)} rails=${s.rails}` +
        (s.landing ? ` land=(${s.landing.x.toFixed(1)},${s.landing.y.toFixed(1)})` : ''),
    );
    console.log(`   ${s.explanation}`);
    // Closest approach of every cue-ball path leg to each later ball center.
    const path = s.path ?? [];
    const later = layout.balls.filter((b) => b.num > s.ball.num);
    for (const b of later) {
      let mind = Infinity;
      for (let k = 0; k + 1 < path.length; k++) {
        mind = Math.min(mind, distPointSegment(b.pos, path[k], path[k + 1]));
      }
      const clear = mind - 2 * 1.125; // 2R gap (BALL_R≈1.125)
      console.log(
        `   path vs ${b.num}: closest center dist ${mind.toFixed(1)}", gap ${clear.toFixed(1)}"` +
          (clear < 1 ? '  <-- BLOCKED/threading' : ''),
      );
    }
  });
}
