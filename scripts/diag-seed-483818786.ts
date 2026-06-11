// Diagnose seed 483818786 (feedback round 9, image #22): why does shot 2
// land in the tiny 9->TL window instead of the huge 9->BL one (draw two
// rails, or more angle on the 8 + follow one rail)?

import { vec, add, scale, norm, sub } from '../src/geometry';
import { POCKETS, pocketById, PocketId } from '../src/table';
import { generatePuzzle } from '../src/generator';
import {
  shotGeometry,
  departureDir,
  minCueTravel,
  hitDistance,
  tracePath,
  ShotType,
} from '../src/shots';
import {
  INTERMEDIATE,
  potProbability,
  powerFactor,
  routeReliability,
} from '../src/skill';
import { zoneContext, zoneValue, zonePeak } from '../src/zone';
import { expectedNextPot } from '../src/solver';

const skill = INTERMEDIATE;
const puzzle = generatePuzzle(483818786, 3, skill)!;
for (const b of puzzle.layout.balls) {
  console.log(`ball ${b.num}: (${b.pos.x.toFixed(1)}, ${b.pos.y.toFixed(1)})`);
}
const shot2 = puzzle.pattern.shots[1];
console.log(
  `shot2 cue (${shot2.cuePos.x.toFixed(1)}, ${shot2.cuePos.y.toFixed(1)}), ` +
    `${shot2.type} ${shot2.rails} rails travel ${shot2.travel.toFixed(0)}", ` +
    `landing (${shot2.landing!.x.toFixed(1)}, ${shot2.landing!.y.toFixed(1)}), eNext ${shot2.eNext?.toFixed(3)}`,
);

const b8 = puzzle.layout.balls[1].pos;
const b9 = puzzle.layout.balls[2].pos;

// 9's zones (no later balls -> pot-only, which is also what gates shot 2).
const zones = new Map<string, ReturnType<typeof zoneContext>>();
for (const p of POCKETS) {
  const zc = zoneContext(b9, p, []);
  if (!zc.ballPathClear) continue;
  const peak = zonePeak(zc, skill);
  if (peak > 0) {
    zones.set(p.id, zc);
    console.log(`9 -> ${p.id}: peak ${peak.toFixed(3)}`);
  }
}

// From shot 2's actual cue position: every type x pocket-for-the-8, walk the
// path and report the best landing into each 9-zone.
const cue = shot2.cuePos;
for (const pid of ['BR', 'TR'] as PocketId[]) {
  const pocket = pocketById(pid);
  const g = shotGeometry(cue, b8, pocket);
  if (!g) continue;
  const pot = potProbability(g, pocket, skill);
  if (pot <= 0.1) continue;
  console.log(`\n8 -> ${pid}: cut ${((g.cut * 180) / Math.PI).toFixed(0)} deg, pot ${(pot * 100).toFixed(1)}%`);
  for (const type of ['follow', 'stun', 'lowTouch', 'draw'] as ShotType[]) {
    const dir = departureDir(g, type);
    if (!dir) continue;
    const minT = minCueTravel(g, type);
    const tr = tracePath(g.ghost, dir, 220, [b9], 3);
    let s = 0;
    const best = new Map<string, { v: number; t: number; rails: number; p: { x: number; y: number } }>();
    for (let i = 0; i + 1 < tr.points.length; i++) {
      const a = tr.points[i];
      const b = tr.points[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 1e-9) continue;
      const dd = norm(sub(b, a));
      for (let t = 2; t <= segLen; t += 2) {
        const travel = s + t;
        if (travel < minT) continue;
        if (powerFactor(hitDistance(g, type, travel), skill) <= 0.02) continue;
        const p = add(a, scale(dd, t));
        for (const [id, zc] of zones) {
          const v = zoneValue(p, zc, skill);
          const cur = best.get(id);
          if (!cur || v > cur.v) best.set(id, { v, t: travel, rails: i, p });
        }
      }
      s += segLen;
    }
    for (const [id, r] of best) {
      if (r.v < 0.2) continue;
      const e = expectedNextPot(g.ghost, dir, r.t, type, r.rails, [b9], zones.get(id)!, skill, g.dCueGhost);
      const rel = routeReliability(type, g.dCueGhost, skill);
      const pw = powerFactor(hitDistance(g, type, r.t), skill);
      console.log(
        `  ${type} -> 9-${id}: best v ${r.v.toFixed(3)} at t=${r.t.toFixed(0)}" rails ${r.rails} ` +
          `land (${r.p.x.toFixed(1)},${r.p.y.toFixed(1)}) | e ${e.toFixed(3)} rel ${rel.toFixed(2)} pw ${pw.toFixed(2)} ` +
          `=> ${(pot * e * rel * pw).toFixed(3)}`,
      );
    }
  }
}
