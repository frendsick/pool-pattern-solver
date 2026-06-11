// Why does the bottom-rail follow (cue 6.6,40.5, travel ~65) carry a
// pocketRisk penalty? Trace the path and measure clearance to every pocket.

import { add, scale, norm, sub, dist, rotate, distPointSegment } from '../src/geometry';
import { POCKETS, pocketById } from '../src/table';
import { generatePuzzle } from '../src/generator';
import { shotGeometry, departureDir, tracePath, caromCurve } from '../src/shots';
import { INTERMEDIATE } from '../src/skill';
import { vec } from '../src/geometry';

const skill = INTERMEDIATE;
const puzzle = generatePuzzle(663545194, 3, skill)!;
const [b7, b8, b9] = puzzle.layout.balls;
const pocket = pocketById('BL');
const obstacles = [b8.pos, b9.pos];

for (const cue of [vec(6.6, 40.5), vec(16.2, 37.7)]) {
  const g = shotGeometry(cue, b7.pos, pocket)!;
  const dir = departureDir(g, 'follow')!;
  for (const travel of [61, 65, 68]) {
    const curve = caromCurve(g, 'follow', travel) ?? undefined;
    const tr = tracePath(g.ghost, dir, travel, obstacles, 4, curve);
    console.log(
      `cue(${cue.x},${cue.y}) travel=${travel} outcome=${tr.outcome} rails=${tr.rails} ` +
        `end(${tr.end.x.toFixed(1)},${tr.end.y.toFixed(1)})`,
    );
    console.log('  path: ' + tr.points.map((p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(' '));
    for (const p of POCKETS) {
      let d = Infinity;
      for (let i = 0; i + 1 < tr.points.length; i++) {
        d = Math.min(d, distPointSegment(p.target, tr.points[i], tr.points[i + 1]));
      }
      const clear = d - p.captureRadius;
      if (clear < 4) console.log(`  pocket ${p.id}: clear=${clear.toFixed(2)}  <-- RISK`);
    }
  }
}
