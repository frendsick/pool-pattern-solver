// One-off: probe zoneValue / potProbability across cut angle and distance
// for the 8-ball zone of the repro layout.
import { vec, add, scale, rotate, norm, sub } from '../src/geometry';
import { POCKETS, pocketById } from '../src/table';
import { INTERMEDIATE, potProbability } from '../src/skill';
import { shotGeometry } from '../src/shots';
import { zoneContext, zoneValue } from '../src/zone';

const ball8 = vec(29.5, 25.3);
const ball9 = vec(41.9, 29.6);
const TL = pocketById('TL');

const nextZones = POCKETS.map((p) => zoneContext(ball9, p, [])).filter(
  (z) => z.ballPathClear,
);
const z8 = zoneContext(ball8, TL, [ball9], nextZones);

const aimBack = norm(sub(ball8, TL.target)); // straight-in cue direction
console.log('phi(deg)  r=12   r=20   r=30   r=45   r=60   (zoneValue | pot)');
for (const phiDeg of [-60, -45, -30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30, 45, 60]) {
  const dir = rotate(aimBack, (phiDeg * Math.PI) / 180);
  let row = `${String(phiDeg).padStart(7)} `;
  for (const r of [12, 20, 30, 45, 60]) {
    const p = add(ball8, scale(dir, r));
    const v = zoneValue(p, z8, INTERMEDIATE);
    const g = shotGeometry(p, ball8, TL);
    const pot = g ? potProbability(g, TL, INTERMEDIATE) : 0;
    row += ` ${v.toFixed(2)}|${pot.toFixed(2)}`;
  }
  console.log(row);
}
