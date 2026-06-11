// Repro of the straight-shot power feedback (2026-06-11, round 6 screenshots):
// 7 upper right, 8 near the bottom-right pocket, 9 right-center. The solver
// proposed a near-straight shot on the 8 with the cue ball sent two rails
// sideways — impossible: a straight hit keeps almost no cue-ball energy, so
// that route needs a monster stroke. The player would instead leave the cue
// ball near the bottom rail with an angle on the 8 (cueing along the rail is
// fine) and roll around with topspin.

import { vec, dist, norm, sub } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';
import { shotGeometry, hitDistance } from '../src/shots';
import { railDist, railAway } from '../src/zone';

const layout: Layout = {
  seed: 0,
  balls: [
    { num: 7, pos: vec(80.5, 31.6) },
    { num: 8, pos: vec(86.8, 5.5) },
    { num: 9, pos: vec(74.8, 12.9) },
  ],
};

const pattern = solve(layout, INTERMEDIATE);
if (!pattern) {
  console.log('NO PATTERN FOUND');
} else {
  for (const s of pattern.shots) {
    console.log(s.explanation);
    const g = shotGeometry(s.cuePos, s.ball.pos, s.pocket);
    if (g && s.type && s.type !== 'stop') {
      const hit = hitDistance(g, s.type, s.travel);
      console.log(
        `   cut ${s.cutDeg.toFixed(1)}°, travel ${s.travel.toFixed(0)}″, ` +
          `hit ≈ ${hit.toFixed(0)}″ roll-out (comfort ${INTERMEDIATE.hitComfort}, max ${INTERMEDIATE.hitMax})`,
      );
    }
    const rd = railDist(s.cuePos);
    if (rd < 6 && g) {
      console.log(
        `   cue ${rd.toFixed(1)}″ off the rail, away-component ${railAway(s.cuePos, g.cueDir, 6).toFixed(2)}`,
      );
    }
  }
  console.log(`score: ${pattern.score.toFixed(3)}`);
}
