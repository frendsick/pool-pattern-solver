// Round 15: can shot 1 (ball in hand on the 7) land upper-left (~(32,42)) with
// good expected position, enabling the stun-over plan for the 8?
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { pocketById, POCKETS, BALL_R } from '../src/table';
import { zoneContext, zoneValue } from '../src/zone';
import { shotGeometry, departureDir, caromCurve, caromLocus, minCueTravel, tracePath, hitDistance } from '../src/shots';
import { expectedNextPot } from '../src/solver';
import { routeReliability, powerFactor, potProbability } from '../src/skill';
import { vec, add, scale, rotate, norm, sub, dist } from '../src/geometry';

const puzzle = generatePuzzle(671833607, 3, INTERMEDIATE)!;
const [seven, eight, nine] = puzzle.layout.balls;

// The 8's gated zone (same construction as the solver's zoneTargets).
const nextZones = POCKETS.map((p) => zoneContext(nine.pos, p, [])).filter((z) => z.ballPathClear);
const zc8 = zoneContext(eight.pos, pocketById('TS'), [nine.pos], nextZones);

const BOX = { x0: 22, x1: 40, y0: 35, y1: 46 };
interface Hit { e1: number; pot1: number; pocket: string; type: string; travel: number; cue: {x:number;y:number}; landing: {x:number;y:number}; cut: number }
const hits: Hit[] = [];

for (const pocket of POCKETS) {
  const aim = norm(sub(pocket.target, seven.pos));
  const aimBack = scale(aim, -1);
  const ghost = add(seven.pos, scale(aimBack, 2 * 1.125));
  for (const aDeg of [-60,-45,-30,-20,-10,0,10,20,30,45,60]) {
    for (const d of [10,16,24,34]) {
      const cue = add(ghost, scale(rotate(aimBack, (aDeg*Math.PI)/180), d));
      const g = shotGeometry(cue, seven.pos, pocket);
      if (!g) continue;
      const pot1 = potProbability(g, pocket, INTERMEDIATE);
      if (pot1 < 0.9) continue;
      for (const type of ['follow','stun','lowTouch','draw'] as const) {
        const dir = departureDir(g, type);
        if (!dir) continue;
        for (let t = Math.max(1, minCueTravel(g, type)); t <= 220; t += 4) {
          const curve = caromCurve(g, type, t) ?? undefined;
          const tr = tracePath(g.ghost, dir, t, [eight.pos, nine.pos], 4, curve);
          if (tr.outcome !== 'ok') continue;
          const p = tr.end;
          if (p.x < BOX.x0 || p.x > BOX.x1 || p.y < BOX.y0 || p.y > BOX.y1) continue;
          const ease = routeReliability(type, g.dCueGhost, INTERMEDIATE) * powerFactor(hitDistance(g, type, t), INTERMEDIATE);
          if (ease < 0.3) continue;
          const e1 = expectedNextPot(g.ghost, dir, t, type, tr.rails, [eight.pos, nine.pos], zc8, INTERMEDIATE, g.dCueGhost, { g, pocket }, curve) * ease;
          hits.push({ e1, pot1, pocket: pocket.id, type, travel: t, cue, landing: p, cut: g.cut*180/Math.PI });
          break; // first travel hitting the box per (cue,type) is enough; keep scanning others
        }
      }
    }
  }
}
hits.sort((a,b) => b.e1*b.pot1 - a.e1*a.pot1);
for (const h of hits.slice(0, 10)) {
  console.log(`7->${h.pocket} cut ${h.cut.toFixed(0)} ${h.type} travel ${h.travel}" cue(${h.cue.x.toFixed(0)},${h.cue.y.toFixed(0)}) -> (${h.landing.x.toFixed(1)},${h.landing.y.toFixed(1)}): pot1 ${h.pot1.toFixed(3)}, e1 ${h.e1.toFixed(3)}, plan-B total ~ ${(h.pot1*h.e1*0.94).toFixed(3)}`);
}
console.log(`hits: ${hits.length} (plan A total 0.749)`);
