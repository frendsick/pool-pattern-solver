// Image #31 diagnosis: the user wants a SMALLER cut on the 5 -> TS so the
// follow climbs to the top rail and folds back down ALONG the 6 -> BR line.
// The initialNodes angle grid only offers 10 and 20 deg around there. Sweep
// the cut angle continuously (cue below-left of the 5 at d=8) and price every
// travel exactly as expandPass does, to find the continuum optimum and how
// its post-rail leg aligns with the 6's shot line.

import { vec, add, scale, norm, sub, rotate, Vec, dist } from '../src/geometry';
import { Layout, pocketById } from '../src/table';
import {
  INTERMEDIATE, routeReliability, powerFactor, potProbability,
} from '../src/skill';
import { expectedNextPot } from '../src/solver';
import { zoneContext, zoneValue } from '../src/zone';
import {
  shotGeometry, departureDir, caromCurve, caromLocus, minCueTravel, tracePath,
  hitDistance,
} from '../src/shots';
import { surfacesForLayout, gateFor } from '../src/value';

const layout: Layout = {
  seed: 0,
  balls: [
    { num: 5, pos: vec(56.35, 15.72) },
    { num: 6, pos: vec(93.8, 19.07) },
    { num: 7, pos: vec(76.97, 19.82) },
    { num: 8, pos: vec(39.26, 25.78) },
    { num: 9, pos: vec(49.47, 24.93) },
  ],
};
const [fiveB, sixB, sevenB, eightB, nineB] = layout.balls;
const surfaces = surfacesForLayout(layout, INTERMEDIATE);
const later = [sevenB, eightB, nineB];
const obstacles = [sixB.pos, ...later.map((b) => b.pos)];
const zc = zoneContext(
  sixB.pos, pocketById('BR'), later.map((b) => b.pos), [], gateFor(surfaces, 2),
);
const lineDir = norm(sub(pocketById('BR').target, sixB.pos)); // 6 -> BR aim

const aimTS = norm(sub(pocketById('TS').target, fiveB.pos));
const ghostTS = sub(fiveB.pos, scale(aimTS, 2.25));

console.log('cut | pot  | best-e travel rails land        | rail-leg vs 6->BR line | e0(best rails-0)');
for (let aDeg = -40; aDeg <= -4; aDeg += 2) {
  const cue = add(ghostTS, scale(rotate(scale(aimTS, -1), (aDeg * Math.PI) / 180), 8));
  const g = shotGeometry(cue, fiveB.pos, pocketById('TS'));
  if (!g) continue;
  const pot = potProbability(g, pocketById('TS'), INTERMEDIATE);
  const dir = departureDir(g, 'follow')!;
  const ease0 = routeReliability('follow', g.dCueGhost, INTERMEDIATE);
  let best = { e: 0, t: 0, end: vec(0, 0), rails: 0 };
  let best0 = { e: 0, t: 0, end: vec(0, 0) };
  for (let t = Math.max(1, minCueTravel(g, 'follow')); t <= 220; t += 1) {
    const curve = caromCurve(g, 'follow', t) ?? undefined;
    const tr = tracePath(g.ghost, dir, t, obstacles, 4, curve);
    if (tr.outcome !== 'ok') continue;
    const ease = ease0 * powerFactor(hitDistance(g, 'follow', t), INTERMEDIATE);
    const e =
      expectedNextPot(g.ghost, dir, t, 'follow', tr.rails, obstacles, zc,
        INTERMEDIATE, g.dCueGhost, { g, pocket: pocketById('TS') }, curve) * ease;
    if (e > best.e) best = { e, t, end: tr.end, rails: tr.rails };
    if (tr.rails === 0 && e > best0.e) best0 = { e, t, end: tr.end };
  }
  // direction of the post-rail leg (long trace, take dir after first rail)
  const locus = caromLocus(g, 'follow')!;
  const trL = tracePath(g.ghost, locus.dir, 200 * locus.eta, obstacles, 3);
  let railLeg = '';
  if (trL.points.length >= 3) {
    const d1 = norm(sub(trL.points[2], trL.points[1]));
    const a = Math.acos(Math.min(1, Math.abs(d1.x * lineDir.x + d1.y * lineDir.y))) * 180 / Math.PI;
    railLeg = `${a.toFixed(0)} deg off`;
  }
  console.log(
    `${(-aDeg).toString().padStart(3)} | ${pot.toFixed(2)} | e ${best.e.toFixed(3)} t ${String(best.t).padStart(3)}" r${best.rails} (${best.end.x.toFixed(1)},${best.end.y.toFixed(1)})` +
    ` | ${railLeg.padStart(10)} | e0 ${best0.e.toFixed(3)} t ${best0.t}" (${best0.end.x.toFixed(1)},${best0.end.y.toFixed(1)})`,
  );
}

// Walk e over travel for the most promising aligned cuts, to see the shape.
for (const aDeg of [-14, -16, -18]) {
  const cue = add(ghostTS, scale(rotate(scale(aimTS, -1), (aDeg * Math.PI) / 180), 8));
  const g = shotGeometry(cue, fiveB.pos, pocketById('TS'))!;
  const dir = departureDir(g, 'follow')!;
  const ease0 = routeReliability('follow', g.dCueGhost, INTERMEDIATE);
  console.log(`\n=== cut ${-aDeg} deg: e(travel) ===`);
  let row = '';
  for (let t = 20; t <= 130; t += 5) {
    const curve = caromCurve(g, 'follow', t) ?? undefined;
    const tr = tracePath(g.ghost, dir, t, obstacles, 4, curve);
    if (tr.outcome !== 'ok') { row += `${t}:${tr.outcome.slice(0,3).toUpperCase()} `; continue; }
    const ease = ease0 * powerFactor(hitDistance(g, 'follow', t), INTERMEDIATE);
    const e =
      expectedNextPot(g.ghost, dir, t, 'follow', tr.rails, obstacles, zc,
        INTERMEDIATE, g.dCueGhost, { g, pocket: pocketById('TS') }, curve) * ease;
    row += `${t}:${e.toFixed(2)}${tr.rails > 0 ? `r${tr.rails}` : ''} `;
    if ((t - 20) % 30 === 25) { console.log('  ' + row); row = ''; }
  }
  if (row) console.log('  ' + row);
  // landing line after the rail: where does the leg run relative to the 6?
  const locus = caromLocus(g, 'follow')!;
  const trL = tracePath(g.ghost, locus.dir, 200 * locus.eta, obstacles, 3);
  if (trL.points.length >= 3) {
    const p1 = trL.points[1];
    const d1 = norm(sub(trL.points[2], trL.points[1]));
    // distance of the 6 from the post-rail leg's line
    const toBall = sub(sixB.pos, p1);
    const cross = Math.abs(toBall.x * d1.y - toBall.y * d1.x);
    console.log(`  rail at (${p1.x.toFixed(1)},${p1.y.toFixed(1)}), leg dir (${d1.x.toFixed(2)},${d1.y.toFixed(2)}), 6 sits ${cross.toFixed(1)}" off the leg's line`);
  }
}
