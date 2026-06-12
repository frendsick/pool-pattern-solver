// Why does shot 2 stop (leaving a long 9 to BR) instead of following to the
// right side for the 9 into the top side pocket?
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { POCKETS, pocketById } from '../src/table';
import { zoneContext, zonePeak, zoneValue, zoneGhost } from '../src/zone';
import { shotGeometry, departureDir, caromLocus, caromCurve, minCueTravel, tracePath } from '../src/shots';
import { expectedNextPot } from '../src/solver';
import { routeReliability, powerFactor } from '../src/skill';
import { hitDistance } from '../src/shots';

const puzzle = generatePuzzle(671833607, 3, INTERMEDIATE)!;
const shots = puzzle.pattern.shots;
for (const s of shots) {
  console.log(`shot ${s.ball.num} -> ${s.pocket.id}, cue (${s.cuePos.x.toFixed(1)},${s.cuePos.y.toFixed(1)}), cut ${s.cutDeg.toFixed(0)}, type ${s.type}, travel ${s.travel.toFixed(0)}, landing ${s.landing ? `(${s.landing.x.toFixed(1)},${s.landing.y.toFixed(1)})` : '-'}, pot ${s.potProb.toFixed(2)}, eNext ${s.eNext?.toFixed(2) ?? '-'}`);
}

// Shot 2: 8 -> TS from the solved cue position. Compare exits toward 9's zones.
const s2 = shots[1];
const nine = shots[2].ball;
const g = shotGeometry(s2.cuePos, s2.ball.pos, pocketById('TS'))!;
console.log(`\nshot2 geometry: cut ${(g.cut*180/Math.PI).toFixed(1)} deg, dCueGhost ${g.dCueGhost.toFixed(1)}`);

for (const pid of ['TS','BR','TR','BL'] as const) {
  const zc = zoneContext(nine.pos, pocketById(pid), []);
  console.log(`\n9 -> ${pid}: zonePeak ${zonePeak(zc, INTERMEDIATE).toFixed(3)}, stop-landing value ${zoneValue(g.ghost, zc, INTERMEDIATE).toFixed(3)}`);
  for (const type of ['follow','stun','lowTouch','draw'] as const) {
    const dir = departureDir(g, type);
    if (!dir) continue;
    const minT = minCueTravel(g, type);
    let best = { e: 0, t: 0 };
    for (let t = Math.max(1, minT); t <= 220; t += 4) {
      const curve = caromCurve(g, type, t) ?? undefined;
      const tr = tracePath(g.ghost, dir, t, [nine.pos], 4, curve);
      if (tr.outcome !== 'ok') continue;
      const ease = routeReliability(type, g.dCueGhost, INTERMEDIATE) * powerFactor(hitDistance(g, type, t), INTERMEDIATE);
      const e = expectedNextPot(g.ghost, dir, t, type, tr.rails, [nine.pos], zc, INTERMEDIATE, g.dCueGhost, { g, pocket: pocketById('TS') }, curve) * ease;
      if (e > best.e) best = { e, t };
    }
    console.log(`  ${type}: best e ${best.e.toFixed(3)} at travel ${best.t}" (minTravel ${minT.toFixed(1)})`);
  }
}
