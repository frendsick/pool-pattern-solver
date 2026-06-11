// Repro of the aggression feedback (2026-06-12, round 10, image #23):
// 8 ball into the bottom-left corner, ~16 degree cut, cue ball short above
// the 8 (an easy, quite short pot), 9 far up-table on the right. The solver
// played a touch of low to a landing ~50" from the 9 (position 77%). The
// player: with a pot this easy and short, be MORE AGGRESSIVE — maximum draw,
// landing as close to the 9 as the window allows while keeping a margin for
// error. Half a table on the 9 is still missable; 0.5-1 m closer is not.
//
// This script scores every (type, travel) route off the fixed cue position
// with the same math as expandPass: e = expectedNextPot * ease.

import { vec, add, scale, norm, sub, dist } from '../src/geometry';
import { pocketById, POCKETS } from '../src/table';
import {
  ShotType,
  shotGeometry,
  departureDir,
  minCueTravel,
  hitDistance,
  tracePath,
} from '../src/shots';
import { INTERMEDIATE, powerFactor, routeReliability, drawRailFactor, distanceSigma } from '../src/skill';
import { expectedNextPot } from '../src/solver';
import { zoneContext, zoneValue } from '../src/zone';
import { solve } from '../src/solver';
import { Layout } from '../src/table';

const ball8 = vec(24, 15);
const ball9 = vec(82, 36);
const pocket = pocketById('BL');
const cue = vec(39.7, 31.5);

const skill = INTERMEDIATE;
const g = shotGeometry(cue, ball8, pocket)!;
console.log(`cut ${(g.cut * 180 / Math.PI).toFixed(1)} deg, cue-to-ghost ${g.dCueGhost.toFixed(1)}"`);

// Zone for the 9 (last ball: no onward gate), per pocket.
const zones = POCKETS.map((p) => zoneContext(ball9, p, [])).filter((z) => z.ballPathClear);
const obstacles = [ball9];

for (const type of ['follow', 'stun', 'lowTouch', 'draw'] as ShotType[]) {
  const dir = departureDir(g, type);
  if (!dir) continue;
  const minTravel = minCueTravel(g, type);
  const rel = routeReliability(type, g.dCueGhost, skill);
  let best: { e: number; travel: number; landing: { x: number; y: number }; pocket: string; v: number; ease: number } | null = null;
  for (let travel = Math.max(2, minTravel); travel <= 120; travel += 2) {
    const tr = tracePath(g.ghost, dir, travel, obstacles, 4);
    if (tr.outcome !== 'ok') continue;
    const firstSeg = tr.points.length > 2 ? dist(tr.points[0], tr.points[1]) : null;
    const railFac = tr.rails === 0 ? 1 : drawRailFactor(type, firstSeg, skill);
    const ease = rel * railFac * powerFactor(hitDistance(g, type, travel), skill);
    if (ease <= 0.02) continue;
    for (const zc of zones) {
      const e =
        expectedNextPot(g.ghost, dir, travel, type, tr.rails, obstacles, zc, skill, g.dCueGhost, {
          g,
          pocket,
        }) * ease;
      if (!best || e > best.e) {
        best = { e, travel, landing: tr.end, pocket: zc.pocket.id, v: zoneValue(tr.end, zc, skill), ease };
      }
    }
  }
  if (!best) {
    console.log(`${type.padEnd(8)} no feasible route`);
    continue;
  }
  const dTo9 = dist(best.landing, ball9);
  const sigS = distanceSigma(type, best.travel, 0, skill, g.dCueGhost);
  console.log(
    `${type.padEnd(8)} best e=${best.e.toFixed(3)}  travel=${best.travel.toFixed(0)}"  ` +
      `landing (${best.landing.x.toFixed(1)}, ${best.landing.y.toFixed(1)})  ` +
      `dist-to-9 ${dTo9.toFixed(1)}"  via ${best.pocket}  v=${best.v.toFixed(3)} ease=${best.ease.toFixed(3)} sigS=${sigS.toFixed(1)}"`,
  );
}

// End-to-end: the full solver on the same two balls (ball in hand).
const layout: Layout = {
  seed: 0,
  balls: [
    { num: 8, pos: ball8 },
    { num: 9, pos: ball9 },
  ],
};
console.log('\nfull solve:');
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
          ` travel ${s.travel.toFixed(0)}" rails ${s.rails}` +
          ` dist-to-9 ${dist(s.landing, ball9).toFixed(1)}"`,
      );
    }
  }
  console.log(`score: ${pattern.score.toFixed(3)}`);
}
