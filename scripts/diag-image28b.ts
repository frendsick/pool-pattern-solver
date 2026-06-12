// From the solver's ACTUAL shot-2 cue position: chosen follow-into-TR-line
// vs the user's stun/roll over to the right-side window for 9 -> TS.
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { pocketById, POCKETS } from '../src/table';
import { zoneContext } from '../src/zone';
import { shotGeometry, departureDir, caromCurve, minCueTravel, tracePath, hitDistance } from '../src/shots';
import { expectedNextPot } from '../src/solver';
import { routeReliability, powerFactor, potProbability } from '../src/skill';

const puzzle = generatePuzzle(671833607, 3, INTERMEDIATE)!;
const shots = puzzle.pattern.shots;
const s2 = shots[1];
const nine = shots[2].ball;
console.log(`shot2 cue (${s2.cuePos.x.toFixed(1)},${s2.cuePos.y.toFixed(1)}), chosen: ${s2.type} ${s2.rails} rail travel ${s2.travel.toFixed(0)}" -> 9->${shots[2].pocket.id} (cut ${shots[2].cutDeg.toFixed(0)}, pot ${shots[2].potProb.toFixed(3)}), eNext ${s2.eNext?.toFixed(3)}`);

const g = shotGeometry(s2.cuePos, s2.ball.pos, pocketById('TS'))!;
for (const pid of ['TS','TR','BR'] as const) {
  const zc = zoneContext(nine.pos, pocketById(pid), []);
  for (const type of ['follow','stun','lowTouch','draw'] as const) {
    const dir = departureDir(g, type);
    if (!dir) continue;
    let best = { e: 0, t: 0, rails: 0 };
    for (let t = Math.max(1, minCueTravel(g, type)); t <= 200; t += 3) {
      const curve = caromCurve(g, type, t) ?? undefined;
      const tr = tracePath(g.ghost, dir, t, [nine.pos], 4, curve);
      if (tr.outcome !== 'ok') continue;
      const ease = routeReliability(type, g.dCueGhost, INTERMEDIATE) * powerFactor(hitDistance(g, type, t), INTERMEDIATE);
      const e = expectedNextPot(g.ghost, dir, t, type, tr.rails, [nine.pos], zc, INTERMEDIATE, g.dCueGhost, { g, pocket: pocketById('TS') }, curve) * ease;
      if (e > best.e) best = { e, t, rails: tr.rails };
    }
    if (best.e > 0.5) console.log(`  9->${pid} ${type}: e ${best.e.toFixed(3)} at travel ${best.t}" (${best.rails} rails)`);
  }
}
