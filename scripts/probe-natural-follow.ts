// Probe: compare the solver's chosen draw route off the 7 (bottom-left
// corner) with the player's natural-follow alternative (top-left corner,
// ~30 degree cut, one rail to center table) on the round-8 feedback layout.

import { vec, norm, sub, dist } from '../src/geometry';
import { POCKETS, pocketById } from '../src/table';
import { shotGeometry, departureDir, minCueTravel, hitDistance, tracePath } from '../src/shots';
import { INTERMEDIATE, potProbability, powerFactor, routeReliability, distanceSigma, directionSigma } from '../src/skill';
import { zoneContext, zoneValue, zonePeak } from '../src/zone';
import { expectedNextPot } from '../src/solver';

const skill = INTERMEDIATE;
const b7 = vec(4.4, 27.9);
const b8 = vec(87.9, 17.0);
const b9 = vec(14.4, 15.0);

// 8's zone, gated on onward control to the 9 (same as the solver's search).
const nineZones = POCKETS.map((p) => zoneContext(b9, p, [])).filter((z) => z.ballPathClear);
const zc8 = (pid: 'BR' | 'TR' | 'BS' | 'TS' | 'BL' | 'TL') =>
  zoneContext(b8, pocketById(pid), [b9], nineZones);

function probe(label: string, cue: { x: number; y: number }, pid: 'BL' | 'TL', type: 'follow' | 'draw' | 'stun', travel: number) {
  const pocket = pocketById(pid);
  const g = shotGeometry(cue, b7, pocket)!;
  const pot = potProbability(g, pocket, skill);
  const dir = departureDir(g, type)!;
  const tr = tracePath(g.ghost, dir, travel, [b8, b9], 4);
  const zc = zc8('BR');
  const v = zoneValue(tr.end, zc, skill);
  const e = expectedNextPot(g.ghost, dir, travel, type, tr.rails, [b8, b9], zc, skill, g.dCueGhost);
  const rel = routeReliability(type, g.dCueGhost, skill);
  const pw = powerFactor(hitDistance(g, type, travel), skill);
  const sigD = directionSigma(type, tr.rails, skill, g.dCueGhost);
  const sigS = distanceSigma(type, travel, tr.rails, skill, g.dCueGhost);
  console.log(
    `${label}: cut ${(g.cut * 180 / Math.PI).toFixed(0)} deg, pot ${(pot * 100).toFixed(1)}%, ` +
    `minTravel ${minCueTravel(g, type).toFixed(0)}", land (${tr.end.x.toFixed(1)},${tr.end.y.toFixed(1)}) rails ${tr.rails}`,
  );
  console.log(
    `   landV ${v.toFixed(3)}, eSpread ${e.toFixed(3)}, rel ${rel.toFixed(3)}, power ${pw.toFixed(2)}, ` +
    `sigDir ${(sigD * 180 / Math.PI).toFixed(2)} deg, sigDist ${sigS.toFixed(1)}", total e*rel*pw ${(e * rel * pw).toFixed(3)}, pot*that ${(pot * e * rel * pw).toFixed(3)}`,
  );
}

console.log('zone peak 8->BR (gated):', zonePeak(zc8('BR'), skill).toFixed(3));

// Solver's pick: cue above the 7, 20 deg cut to BL, draw one rail, 67".
probe('solver draw  BL', vec(2.8, 39.9), 'BL', 'draw', 67);

// Player's pick: cue below the 7 (image 21), ~30 deg cut to TL, follow.
for (const t of [60, 70, 80, 90]) probe(`player follow TL t=${t}`, vec(2.7, 19.0), 'TL', 'follow', t);
