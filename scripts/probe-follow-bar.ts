// Does ANY ball-in-hand placement give a follow route off the 7 whose path
// clears the strict landing bar (0.8 x best pocket peak) of the 8's zone?

import { vec, add, scale, norm, sub, rotate } from '../src/geometry';
import { BALL_R, POCKETS, pocketById, PocketId } from '../src/table';
import { shotGeometry, departureDir, minCueTravel, hitDistance, tracePath } from '../src/shots';
import { INTERMEDIATE, powerFactor } from '../src/skill';
import { zoneContext, zoneValue, zonePeak } from '../src/zone';

const skill = INTERMEDIATE;
const b7 = vec(4.4, 27.9);
const b8 = vec(87.9, 17.0);
const b9 = vec(14.4, 15.0);

const nineZones = POCKETS.map((p) => zoneContext(b9, p, [])).filter((z) => z.ballPathClear);

let bestPeak = 0;
const zcs: { id: string; zc: ReturnType<typeof zoneContext> }[] = [];
for (const p of POCKETS) {
  const zc = zoneContext(b8, p, [b9], nineZones);
  if (!zc.ballPathClear) continue;
  const peak = zonePeak(zc, skill);
  if (peak <= 0) continue;
  bestPeak = Math.max(bestPeak, peak);
  zcs.push({ id: p.id, zc });
  console.log(`8 -> ${p.id}: gated peak ${peak.toFixed(3)}`);
}
const bar = 0.8 * bestPeak;
console.log(`strict bar: ${bar.toFixed(3)}\n`);

for (const pid of ['TL', 'BL'] as PocketId[]) {
  const pocket = pocketById(pid);
  const aim = norm(sub(pocket.target, b7));
  const ghost = sub(b7, scale(aim, 2 * BALL_R));
  const aimBack = scale(aim, -1);
  let best = { v: 0, cut: 0, t: 0, aDeg: 0, d: 0, zid: '' };
  for (const aDeg of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    for (const d of [10, 16, 24, 34]) {
      const c = add(ghost, scale(rotate(aimBack, (aDeg * Math.PI) / 180), d));
      const g = shotGeometry(c, b7, pocket);
      if (!g) continue;
      const dir = departureDir(g, 'follow');
      if (!dir) continue;
      const minT = minCueTravel(g, 'follow');
      const tr = tracePath(g.ghost, dir, 220, [b8, b9], 3);
      let s = 0;
      for (let i = 0; i + 1 < tr.points.length; i++) {
        const a = tr.points[i];
        const b = tr.points[i + 1];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const dd = norm(sub(b, a));
        for (let t = 2; t <= segLen; t += 2) {
          const travel = s + t;
          if (travel < minT) continue;
          if (powerFactor(hitDistance(g, 'follow', travel), skill) <= 0.02) continue;
          const p = add(a, scale(dd, t));
          for (const { id, zc } of zcs) {
            const v = zoneValue(p, zc, skill);
            if (v > best.v) best = { v, cut: (g.cut * 180) / Math.PI, t: travel, aDeg, d, zid: id };
          }
        }
        s += segLen;
      }
    }
  }
  console.log(
    `7 -> ${pid}: best follow path value ${best.v.toFixed(3)} ` +
      `(cut ${best.cut.toFixed(0)} deg, node a=${best.aDeg} d=${best.d}, travel ${best.t.toFixed(0)}", into 8->${best.zid})` +
      `  ${best.v >= bar ? 'CLEARS bar' : 'PRUNED by bar'}`,
  );
}
