// Repro of the 2026-06-12 round-12 feedback (image #24, seed 663545194):
// ball in hand on the 7 (BL corner). The solver placed the cue ball up-right
// of the 7 and played a follow off the LEFT rail that crosses the 8's window
// at an angle (8" of path inside). The player: spot the cue ball a bit more
// left and play the follow off the BOTTOM rail — the rebound runs along the
// 8's shot line, so the cue ball stays inside the position window much
// longer, and ball in hand makes that placement free.
//
// This script: (1) prints the solver's plan, (2) sweeps ball-in-hand
// placements x follow travels and scores them with expandPass's math
// (e = expectedNextPot * ease), grouped by which rail the route uses.

import { vec, add, scale, norm, sub, rotate, dist, angleBetween } from '../src/geometry';
import { POCKETS, pocketById, MIN_Y, MIN_X, MAX_X, MAX_Y } from '../src/table';
import {
  ShotType,
  shotGeometry,
  departureDir,
  minCueTravel,
  hitDistance,
  tracePath,
  caromCurve,
} from '../src/shots';
import {
  INTERMEDIATE,
  powerFactor,
  routeReliability,
  drawRailFactor,
} from '../src/skill';
import { expectedNextPot, solve } from '../src/solver';
import { zoneContext, zoneValue } from '../src/zone';
import { generatePuzzle } from '../src/generator';

const skill = INTERMEDIATE;
const puzzle = generatePuzzle(663545194, 3, skill)!;
const [b7, b8, b9] = puzzle.layout.balls;
console.log(`7 (${b7.pos.x.toFixed(1)}, ${b7.pos.y.toFixed(1)})  8 (${b8.pos.x.toFixed(1)}, ${b8.pos.y.toFixed(1)})  9 (${b9.pos.x.toFixed(1)}, ${b9.pos.y.toFixed(1)})`);

const s1 = puzzle.pattern.shots[0];
console.log(`\nchosen: cue (${s1.cuePos.x.toFixed(1)}, ${s1.cuePos.y.toFixed(1)}) cut ${s1.cutDeg.toFixed(1)} type ${s1.type} rails ${s1.rails} travel ${s1.travel.toFixed(0)}" eNext ${s1.eNext?.toFixed(3)} zoneLen ${s1.zoneLen?.toFixed(0)} entryDeg ${s1.entryDeg?.toFixed(0)}`);
if (s1.path) {
  console.log('path: ' + s1.path.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '));
}

// The 8's onward-gated zone, exactly as zoneTargets builds it.
const nextZones = POCKETS.map((p) => zoneContext(b9.pos, p, [])).filter((z) => z.ballPathClear);
const targets = POCKETS.map((p) => ({
  pocket: p,
  zc: zoneContext(b8.pos, p, [b9.pos], nextZones),
})).filter((t) => t.zc.ballPathClear);

const pocket = pocketById('BL');
const zcFirst = zoneContext(b7.pos, pocket, [b8.pos, b9.pos]);
const obstacles = [b8.pos, b9.pos];

function railName(p: { x: number; y: number }): string {
  if (p.y <= MIN_Y + 0.1) return 'bottom';
  if (p.y >= MAX_Y - 0.1) return 'top';
  if (p.x <= MIN_X + 0.1) return 'left';
  if (p.x >= MAX_X - 0.1) return 'right';
  return '?';
}

// Sweep ball-in-hand placements: same grid as initialNodes plus finer angles.
const aim = norm(sub(pocket.target, b7.pos));
const aimBack = scale(aim, -1);
const ghostBase = add(b7.pos, scale(aimBack, 2 * 1.125));
const angles: number[] = [];
for (let a = -60; a <= 60; a += 5) angles.push(a);
const dists = [10, 16, 24, 34];

interface Best {
  e: number;
  aDeg: number;
  d: number;
  cue: { x: number; y: number };
  cut: number;
  pot: number;
  travel: number;
  rails: number;
  firstRail: string;
  landing: { x: number; y: number };
  entryDeg: number;
  pocket: string;
  score: number;
}
const bestByRail = new Map<string, Best>();

for (const aDeg of angles) {
  for (const d of dists) {
    const cue = add(ghostBase, scale(rotate(aimBack, (aDeg * Math.PI) / 180), d));
    const pot = zoneValue(cue, zcFirst, skill);
    if (pot < 0.35) continue;
    const g = shotGeometry(cue, b7.pos, pocket);
    if (!g) continue;
    const type: ShotType = 'follow';
    const dir = departureDir(g, type);
    if (!dir) continue;
    const minTravel = minCueTravel(g, type);
    const rel = routeReliability(type, g.dCueGhost, skill);
    for (let travel = Math.max(2, minTravel); travel <= 160; travel += 2) {
      const curve = caromCurve(g, type, travel) ?? undefined;
      const tr = tracePath(g.ghost, dir, travel, obstacles, 4, curve);
      if (tr.outcome !== 'ok') continue;
      const firstSeg = tr.points.length > 2 ? dist(tr.points[0], tr.points[1]) : null;
      const railFac = tr.rails === 0 ? 1 : drawRailFactor(type, firstSeg, skill);
      const ease = rel * railFac * powerFactor(hitDistance(g, type, travel), skill);
      if (ease <= 0.02) continue;
      for (const t of targets) {
        const v = zoneValue(tr.end, t.zc, skill);
        if (v <= 0) continue;
        const eN =
          expectedNextPot(g.ghost, dir, travel, type, tr.rails, obstacles, t.zc, skill, g.dCueGhost, { g, pocket }, curve) * ease;
        const score = pot * eN;
        // entry direction = path dir at the landing
        const n = tr.points.length;
        const lastDir = norm(sub(tr.points[n - 1], tr.points[n - 2]));
        const aim8 = norm(sub(t.zc.pocket.target, b8.pos));
        let ang = angleBetween(lastDir, aim8);
        ang = Math.min(ang, Math.PI - ang) * (180 / Math.PI);
        const firstRail = tr.rails > 0 ? railName(tr.points[1]) : 'none';
        const key = `${firstRail}/${tr.rails}`;
        const prev = bestByRail.get(key);
        if (!prev || score > prev.score) {
          bestByRail.set(key, {
            e: eN, aDeg, d, cue, cut: (g.cut * 180) / Math.PI, pot,
            travel, rails: tr.rails, firstRail, landing: tr.end,
            entryDeg: ang, pocket: t.pocket.id, score,
          });
        }
      }
    }
  }
}

console.log('\nbest follow route by (first rail / rail count), score = pot * e:');
const rows = [...bestByRail.values()].sort((a, b) => b.score - a.score);
for (const r of rows) {
  console.log(
    `${(r.firstRail + '/' + r.rails).padEnd(9)} score=${r.score.toFixed(3)} e=${r.e.toFixed(3)} pot=${r.pot.toFixed(3)} ` +
      `cue(${r.cue.x.toFixed(1)},${r.cue.y.toFixed(1)}) a=${r.aDeg} d=${r.d} cut=${r.cut.toFixed(0)} ` +
      `travel=${r.travel.toFixed(0)}" landing(${r.landing.x.toFixed(1)},${r.landing.y.toFixed(1)}) ` +
      `entry=${r.entryDeg.toFixed(0)}deg via ${r.pocket}`,
  );
}
