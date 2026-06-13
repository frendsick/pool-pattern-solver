// Image #31, part 2: decompose the quadrature for the crossing route (30 deg
// cut, no rail) vs the user's rail-fold route (16-18 deg cut, one rail off
// the top, coming down along the 6 -> BR line). Where does the 0.08 gap in
// expectedNextPot come from — direction noise, distance noise, power tax,
// or the value field itself?

import { vec, add, scale, norm, sub, rotate, dist, Vec } from '../src/geometry';
import { Layout, pocketById } from '../src/table';
import {
  INTERMEDIATE, routeReliability, powerFactor, distanceSigma, directionSigma,
  perturbSamples, caromDirSigma,
} from '../src/skill';
import { expectedNextPot } from '../src/solver';
import { zoneContext, zoneValue } from '../src/zone';
import {
  shotGeometry, departureDir, caromCurve, tracePath, hitDistance,
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
const zcPot = zoneContext(sixB.pos, pocketById('BR'), later.map((b) => b.pos));

const aimTS = norm(sub(pocketById('TS').target, fiveB.pos));
const ghostTS = sub(fiveB.pos, scale(aimTS, 2.25));
const pocket = pocketById('TS');

function probe(label: string, aDeg: number, travel: number) {
  const cue = add(ghostTS, scale(rotate(scale(aimTS, -1), (aDeg * Math.PI) / 180), 8));
  const g = shotGeometry(cue, fiveB.pos, pocket)!;
  const dir = departureDir(g, 'follow')!;
  const curve = caromCurve(g, 'follow', travel) ?? undefined;
  const tr = tracePath(g.ghost, dir, travel, obstacles, 4, curve);
  const sigS = distanceSigma('follow', travel, tr.rails, INTERMEDIATE, g.dCueGhost);
  const sigD = directionSigma('follow', tr.rails, INTERMEDIATE, g.dCueGhost, { g, pocket });
  const cSig = caromDirSigma(g, 'follow', pocket, INTERMEDIATE);
  const pf = powerFactor(hitDistance(g, 'follow', travel), INTERMEDIATE);
  console.log(`\n=== ${label}: cut ${-aDeg} deg, travel ${travel}", rails ${tr.rails}, land (${tr.end.x.toFixed(1)},${tr.end.y.toFixed(1)})`);
  console.log(
    `  sigS ${sigS.toFixed(2)}", sigD ${((sigD * 180) / Math.PI).toFixed(2)} deg` +
    ` (stroke ${(INTERMEDIATE.dirSigma.follow * 180 / Math.PI).toFixed(2)}, carom ${((cSig * 180) / Math.PI).toFixed(2)}, rails +${(tr.rails * INTERMEDIATE.railDirSigma * 180 / Math.PI).toFixed(2)})` +
    `, hitDist ${hitDistance(g, 'follow', travel).toFixed(0)}" pf ${pf.toFixed(3)}`,
  );
  const vL = zoneValue(tr.end, zc, INTERMEDIATE);
  console.log(`  landing value gated ${vL.toFixed(3)} pot-only ${zoneValue(tr.end, zcPot, INTERMEDIATE).toFixed(3)}`);
  // full quadrature with per-sample print
  let e = 0;
  for (const smp of perturbSamples(sigS, sigD)) {
    const dd = rotate(dir, smp.dDir);
    const cv = curve && smp.dDir !== 0
      ? { offsets: curve.offsets.map((o) => rotate(o, smp.dDir)), arc: curve.arc }
      : curve;
    const t = Math.max(0.1, travel + smp.dDist);
    const tr2 = tracePath(g.ghost, dd, t, obstacles, 4, cv);
    const v = tr2.outcome === 'scratch' ? 0 : zoneValue(tr2.end, zc, INTERMEDIATE);
    e += smp.weight * v;
    if (smp.weight > 0.03) {
      console.log(
        `    dDist ${smp.dDist >= 0 ? '+' : ''}${smp.dDist.toFixed(1).padStart(5)}" dDir ${((smp.dDir * 180) / Math.PI).toFixed(1).padStart(5)} deg` +
        ` w ${smp.weight.toFixed(3)} -> (${tr2.end.x.toFixed(1)},${tr2.end.y.toFixed(1)}) ${tr2.outcome !== 'ok' ? tr2.outcome.toUpperCase() + ' ' : ''}v ${v.toFixed(3)}`,
      );
    }
  }
  console.log(`  expectedNextPot ${e.toFixed(3)}, x ease(${(routeReliability('follow', g.dCueGhost, INTERMEDIATE) * pf).toFixed(3)}) = ${(e * routeReliability('follow', g.dCueGhost, INTERMEDIATE) * pf).toFixed(3)}`);
  // counterfactuals: zero out one error source at a time
  const eNoDir = expectedNextPot(g.ghost, dir, travel, 'follow', tr.rails, obstacles, zc, INTERMEDIATE, 0.0001, undefined, curve);
  console.log(`  [check] e with shotDist~0 (no carom/stroke change, sanity): ${eNoDir.toFixed(3)}`);
  let eD0 = 0;
  for (const smp of perturbSamples(sigS, 0)) {
    const t = Math.max(0.1, travel + smp.dDist);
    const tr2 = tracePath(g.ghost, dir, t, obstacles, 4, curve);
    eD0 += smp.weight * (tr2.outcome === 'scratch' ? 0 : zoneValue(tr2.end, zc, INTERMEDIATE));
  }
  let eS0 = 0;
  for (const smp of perturbSamples(0, sigD)) {
    const dd = rotate(dir, smp.dDir);
    const cv = curve && smp.dDir !== 0
      ? { offsets: curve.offsets.map((o) => rotate(o, smp.dDir)), arc: curve.arc }
      : curve;
    const tr2 = tracePath(g.ghost, dd, travel, obstacles, 4, cv);
    eS0 += smp.weight * (tr2.outcome === 'scratch' ? 0 : zoneValue(tr2.end, zc, INTERMEDIATE));
  }
  console.log(`  e | no direction error: ${eD0.toFixed(3)} | no distance error: ${eS0.toFixed(3)}`);
}

probe('A crossing', -30, 41);
probe('B rail-fold 18', -18, 52);
probe('B rail-fold 16', -16, 55);
probe('B rail-fold deeper 18', -18, 60);
