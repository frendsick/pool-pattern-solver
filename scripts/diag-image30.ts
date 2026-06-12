// Image #30 diagnosis: why does the BR route (crossing the 6's window) price
// the same as the TR route (traveling along it)? Probe the gated value field
// along each route's landing spread and break down the quadrature.

import { vec, add, scale, norm, sub, dist, Vec } from '../src/geometry';
import { Layout, pocketById, PocketId } from '../src/table';
import {
  INTERMEDIATE, distanceSigma, directionSigma, perturbSamples,
} from '../src/skill';
import { expectedNextPot } from '../src/solver';
import { zoneContext, zoneValue, zonePeak } from '../src/zone';
import {
  shotGeometry, departureDir, caromCurve, tracePath,
} from '../src/shots';
import { surfacesForLayout, gateFor } from '../src/value';

const layout: Layout = {
  seed: 0,
  balls: [
    { num: 5, pos: vec(88.3, 15.9) },
    { num: 6, pos: vec(35.9, 23.7) },
    { num: 7, pos: vec(6.9, 37.4) },
    { num: 8, pos: vec(21.2, 26.0) },
    { num: 9, pos: vec(41.5, 18.9) },
  ],
};
const [fiveB, sixB, sevenB, eightB, nineB] = layout.balls;
const surfaces = surfacesForLayout(layout, INTERMEDIATE);
const later = [sevenB, eightB, nineB];
const obstacles = [sixB.pos, ...later.map((b) => b.pos)];
const zc = zoneContext(
  sixB.pos, pocketById('BL'), later.map((b) => b.pos), [], gateFor(surfaces, 2),
);
console.log('zone peak (6->BL gated):', zonePeak(zc, INTERMEDIATE).toFixed(3));

function probeRoute(label: string, cue: Vec, pid: PocketId, travel: number) {
  const pocket = pocketById(pid);
  const g = shotGeometry(cue, fiveB.pos, pocket)!;
  const dir = departureDir(g, 'follow')!;
  const curve = caromCurve(g, 'follow', travel) ?? undefined;
  const tr = tracePath(g.ghost, dir, travel, obstacles, 4, curve);
  const sigS = distanceSigma('follow', travel, tr.rails, INTERMEDIATE, g.dCueGhost);
  const sigD = directionSigma('follow', tr.rails, INTERMEDIATE, g.dCueGhost, { g, pocket });
  console.log(`\n=== ${label}: cue (${cue.x.toFixed(1)},${cue.y.toFixed(1)}) -> ${pid}, travel ${travel.toFixed(0)}" rails ${tr.rails}`);
  console.log(`  cut ${((g.cut * 180) / Math.PI).toFixed(1)} deg, land (${tr.end.x.toFixed(1)},${tr.end.y.toFixed(1)}), sigS ${sigS.toFixed(2)}", sigD ${((sigD * 180) / Math.PI).toFixed(2)} deg`);
  // landing direction at the end of the path
  const n = tr.points.length;
  const endDir = norm(sub(tr.points[n - 1], tr.points[n - 2]));
  const lineDir = norm(sub(zc.pocket.target, zc.ball)); // 6->BL
  const ang = Math.acos(Math.min(1, Math.abs(endDir.x * lineDir.x + endDir.y * lineDir.y))) * 180 / Math.PI;
  console.log(`  arrival dir vs 6->BL line: ${ang.toFixed(0)} deg`);
  // value along the speed-error axis (perturbed travel, exact trace)
  let row = '  v(travel+k): ';
  for (const k of [-12, -9, -6, -3, 0, 3, 6, 9, 12]) {
    const t2 = travel + k;
    const tr2 = tracePath(g.ghost, dir, Math.max(0.1, t2), obstacles, 4, curve);
    const v = tr2.outcome === 'scratch' ? -1 : zoneValue(tr2.end, zc, INTERMEDIATE);
    row += `${k >= 0 ? '+' : ''}${k}:${v < 0 ? 'SCR' : v.toFixed(2)} `;
  }
  console.log(row);
  // decompose landing value at the intended end
  const v0 = zoneValue(tr.end, zc, INTERMEDIATE);
  const zcPot = zoneContext(sixB.pos, pocketById('BL'), later.map((b) => b.pos));
  const vPot = zoneValue(tr.end, zcPot, INTERMEDIATE);
  console.log(`  landing value gated ${v0.toFixed(3)}, pot-only ${vPot.toFixed(3)} -> control factor ${(v0 / Math.max(vPot, 1e-9)).toFixed(3)}`);
  const e = expectedNextPot(g.ghost, dir, travel, 'follow', tr.rails, obstacles, zc, INTERMEDIATE, g.dCueGhost, { g, pocket }, curve);
  console.log(`  expectedNextPot ${e.toFixed(3)} (= ${(100 * e / Math.max(v0, 1e-9)).toFixed(0)}% of landing value)`);
}

// Solver's route: 5 -> BR from (85.9,27.7), travel 58.2"
probeRoute('A solver BR', vec(85.9, 27.7), 'BR', 58.2);
// User's route: 5 -> TR from (81.3,6.0) (a=-20 d=10), travel 59.6"
probeRoute('B user TR', vec(81.3, 6.0), 'TR', 59.6);

// What does the gated field look like across vs along the line at the window?
console.log('\n=== value field around (59.6,36.5) ===');
const lineDir = norm(sub(pocketById('BL').target, sixB.pos));
const perp = vec(-lineDir.y, lineDir.x);
for (const [name, d] of [['along', lineDir], ['across', perp]] as const) {
  let row = `  ${name}: `;
  for (const k of [-12, -9, -6, -3, 0, 3, 6, 9, 12]) {
    const p = add(vec(59.6, 36.5), scale(d, k));
    row += `${k >= 0 ? '+' : ''}${k}:${zoneValue(p, zc, INTERMEDIATE).toFixed(2)} `;
  }
  console.log(row);
}
// same, pot-only
const zcPot = zoneContext(sixB.pos, pocketById('BL'), later.map((b) => b.pos));
for (const [name, d] of [['along(pot)', lineDir], ['across(pot)', perp]] as const) {
  let row = `  ${name}: `;
  for (const k of [-12, -9, -6, -3, 0, 3, 6, 9, 12]) {
    const p = add(vec(59.6, 36.5), scale(d, k));
    row += `${k >= 0 ? '+' : ''}${k}:${zoneValue(p, zcPot, INTERMEDIATE).toFixed(2)} `;
  }
  console.log(row);
}
