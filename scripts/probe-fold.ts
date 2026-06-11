// Debug the rail-fold test: print every quadrature sample of the landing
// distribution for the direct vs rail-assisted route.

import { vec, add, scale, norm, rotate } from '../src/geometry';
import { pocketById } from '../src/table';
import { zoneContext, zoneValue, railDist } from '../src/zone';
import { INTERMEDIATE, distanceSigma, directionSigma, perturbSamples } from '../src/skill';
import { tracePath } from '../src/shots';

const ball = vec(50, 25);
const ts = pocketById('TS');
const zc = zoneContext(ball, ts, []);
const obstacles = [ball];
const start = vec(55.5, 45);
const down = vec(0, -1);

function dump(label: string, travel: number, rails: number) {
  const sigS = distanceSigma('follow', travel, rails, INTERMEDIATE);
  const sigD = directionSigma('follow', rails, INTERMEDIATE);
  console.log(`${label}: travel ${travel.toFixed(1)} sigS ${sigS.toFixed(2)} sigD ${((sigD * 180) / Math.PI).toFixed(2)}°`);
  let e = 0;
  for (const smp of perturbSamples(sigS, sigD)) {
    const dir = rotate(down, smp.dDir);
    const t = Math.max(0.1, travel + smp.dDist);
    const tr = tracePath(start, dir, t, obstacles, 4);
    const v = tr.outcome === 'scratch' ? 0 : zoneValue(tr.end, zc, INTERMEDIATE);
    if (tr.outcome === 'scratch') {
      console.log(`  w=${smp.weight.toFixed(3)} dDist=${smp.dDist.toFixed(1).padStart(6)} SCRATCH`);
    } else {
      console.log(
        `  w=${smp.weight.toFixed(3)} dDist=${smp.dDist.toFixed(1).padStart(6)} end (${tr.end.x.toFixed(1)}, ${tr.end.y.toFixed(1)}) railDist ${railDist(tr.end).toFixed(1)} v=${v.toFixed(3)}`,
      );
    }
    e += smp.weight * v;
  }
  console.log(`  e = ${e.toFixed(3)}\n`);
}

dump('direct (land y=15)', 30, 0);
dump('rail (land y=8 after cushion)', 45 - 1.125 + (8 - 1.125), 1);
