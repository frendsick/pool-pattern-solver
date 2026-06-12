// 9-to-the-side calibration: from shot-2's actual cue position (seed 671833607),
// compare every 8->TS exit by next pocket WITHOUT a print floor, and dump the
// raw pot probabilities the choice hinges on: the chosen plan's ~45" near-straight
// 9->TR vs the near-hanging 12" 9->TS from the right-side window.
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { pocketById } from '../src/table';
import { zoneContext, zoneValue } from '../src/zone';
import { shotGeometry, departureDir, caromCurve, minCueTravel, tracePath, hitDistance } from '../src/shots';
import { expectedNextPot } from '../src/solver';
import { routeReliability, powerFactor, potProbability } from '../src/skill';

const puzzle = generatePuzzle(671833607, 3, INTERMEDIATE)!;
const shots = puzzle.pattern.shots;
const s2 = shots[1];
const s3 = shots[2];
const nine = s3.ball;
console.log(`shot2: ${s2.ball.num}->${s2.pocket.id} from (${s2.cuePos.x.toFixed(1)},${s2.cuePos.y.toFixed(1)}), ${s2.type} ${s2.rails}r travel ${s2.travel.toFixed(0)}" land (${s2.landing.x.toFixed(1)},${s2.landing.y.toFixed(1)}), eNext ${s2.eNext?.toFixed(3)}`);
console.log(`shot3: 9->${s3.pocket.id} cut ${s3.cutDeg.toFixed(0)} pot ${s3.potProb.toFixed(3)} from (${s3.cuePos.x.toFixed(1)},${s3.cuePos.y.toFixed(1)})`);

const g = shotGeometry(s2.cuePos, s2.ball.pos, s2.pocket)!;
for (const pid of ['TS', 'TR', 'BR', 'BS'] as const) {
  const zc = zoneContext(nine.pos, pocketById(pid), []);
  for (const type of ['follow', 'stun', 'lowTouch', 'draw', 'stop'] as const) {
    const dir = departureDir(g, type);
    if (!dir && type !== 'stop') continue;
    let best = { e: 0, t: 0, rails: 0, land: { x: 0, y: 0 } };
    const tMax = type === 'stop' ? 1 : 250;
    for (let t = Math.max(1, minCueTravel(g, type)); t <= tMax; t += 3) {
      const curve = type === 'stop' ? undefined : (caromCurve(g, type, t) ?? undefined);
      const d = type === 'stop' ? g.aim : dir!;
      const tr = tracePath(g.ghost, d, t, [nine.pos], 4, curve);
      if (tr.outcome !== 'ok') continue;
      const ease = routeReliability(type, g.dCueGhost, INTERMEDIATE) * powerFactor(hitDistance(g, type, t), INTERMEDIATE);
      const e = expectedNextPot(g.ghost, d, t, type, tr.rails, [nine.pos], zc, INTERMEDIATE, g.dCueGhost, { g, pocket: s2.pocket }, curve) * ease;
      if (e > best.e) best = { e, t, rails: tr.rails, land: tr.end };
    }
    if (best.e > 0)
      console.log(`  9->${pid} ${type.padEnd(8)} e ${best.e.toFixed(3)} travel ${best.t.toFixed(0)}" ${best.rails}r land (${best.land.x.toFixed(1)},${best.land.y.toFixed(1)})`);
  }
}

// Raw pot calibration probes
console.log('\n--- pot calibration ---');
const probe = (cue: { x: number; y: number }, label: string, pid: string) => {
  const gg = shotGeometry(cue, nine.pos, pocketById(pid as any));
  if (!gg) { console.log(`${label}: no geometry`); return; }
  console.log(`${label}: cut ${(gg.cut * 180 / Math.PI).toFixed(1)} deg, dCue ${gg.dCueGhost.toFixed(0)}", dPocket ${gg.dBallPocket.toFixed(0)}", pot ${potProbability(gg, pocketById(pid as any), INTERMEDIATE).toFixed(3)}`);
};
// chosen plan's actual leave
probe(s3.cuePos, `chosen leave 9->${s3.pocket.id}`, s3.pocket.id);
// straight 45" 9->TR for reference
{
  const p = pocketById('TR');
  const aim = { x: nine.pos.x - p.target.x, y: nine.pos.y - p.target.y };
  const d = Math.hypot(aim.x, aim.y);
  const cue = { x: nine.pos.x + (aim.x / d) * 45, y: nine.pos.y + (aim.y / d) * 45 };
  probe(cue, 'straight 45" 9->TR', 'TR');
}
// right-side window: a few cue spots right of the 9 along the 9->TS line extension
{
  const p = pocketById('TS');
  const aim = { x: nine.pos.x - p.target.x, y: nine.pos.y - p.target.y };
  const d = Math.hypot(aim.x, aim.y);
  for (const back of [10, 20, 30, 40]) {
    const cue = { x: nine.pos.x + (aim.x / d) * back, y: nine.pos.y + (aim.y / d) * back };
    probe(cue, `straight-ish ${back}" behind 9->TS`, 'TS');
  }
}
