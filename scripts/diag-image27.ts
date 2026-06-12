// Round 15: compare shot-2 plans. A: solver's bottom-left near-straight 8->TS
// + long stop, 9 long to BR. B: user's upper-left angled 8->TS, stun/follow
// over to the 9's big right-side window, 9 -> TS.
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { pocketById, POCKETS } from '../src/table';
import { zoneContext, zoneValue } from '../src/zone';
import { shotGeometry, departureDir, caromCurve, minCueTravel, tracePath, hitDistance } from '../src/shots';
import { expectedNextPot } from '../src/solver';
import { routeReliability, powerFactor, potProbability, distanceSigma } from '../src/skill';
import { vec } from '../src/geometry';

const puzzle = generatePuzzle(671833607, 3, INTERMEDIATE)!;
const [, eightB, nineB] = puzzle.layout.balls;
const ts = pocketById('TS');

function shot2eval(cue: {x:number;y:number}) {
  const g = shotGeometry(cue, eightB.pos, ts);
  if (!g) { console.log('no geometry'); return; }
  const pot8 = potProbability(g, ts, INTERMEDIATE);
  console.log(`cue (${cue.x},${cue.y}): cut ${(g.cut*180/Math.PI).toFixed(1)} deg, dCueGhost ${g.dCueGhost.toFixed(1)}, pot8 ${pot8.toFixed(3)}`);
  for (const pid of ['TS','BR','TR'] as const) {
    const zc = zoneContext(nineB.pos, pocketById(pid), []);
    // stop option
    const sigStop = distanceSigma('stop', 0.5, 0, INTERMEDIATE, g.dCueGhost);
    const eStop = expectedNextPot(g.ghost, g.tangent, 0.5, 'stop', 0, [nineB.pos], zc, INTERMEDIATE, g.dCueGhost, { g, pocket: ts }) * INTERMEDIATE.typeReliability.stop;
    console.log(`  9->${pid}: stop e ${(g.cut < Math.PI/20 ? eStop : 0).toFixed(3)} (drift sigma ${sigStop.toFixed(1)}")`);
    for (const type of ['follow','stun','lowTouch','draw'] as const) {
      const dir = departureDir(g, type);
      if (!dir) continue;
      let best = { e: 0, t: 0 };
      for (let t = Math.max(1, minCueTravel(g, type)); t <= 200; t += 3) {
        const curve = caromCurve(g, type, t) ?? undefined;
        const tr = tracePath(g.ghost, dir, t, [nineB.pos], 4, curve);
        if (tr.outcome !== 'ok') continue;
        const ease = routeReliability(type, g.dCueGhost, INTERMEDIATE) * powerFactor(hitDistance(g, type, t), INTERMEDIATE);
        const e = expectedNextPot(g.ghost, dir, t, type, tr.rails, [nineB.pos], zc, INTERMEDIATE, g.dCueGhost, { g, pocket: ts }, curve) * ease;
        if (e > best.e) best = { e, t };
      }
      if (best.e > 0.02) console.log(`  9->${pid}: ${type} best e ${best.e.toFixed(3)} at travel ${best.t}"`);
    }
  }
}

console.log('--- plan A: solver bottom-left ---');
shot2eval(vec(20.1, 11.8));
console.log('\n--- plan B: upper-left, angle on the 8 ---');
for (const cue of [vec(32,42), vec(28,40), vec(36,43)]) shot2eval(cue);
