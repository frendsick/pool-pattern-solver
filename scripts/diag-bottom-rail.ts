// Step-by-step replica of the solver pipeline for seed 663545194: where does
// the bottom-rail follow placement (cue ~(6.6,40.5), a=30 d=10 on BL) get
// lost? Stage 1: initialNodes' top-12-per-pocket cut.

import { add, scale, norm, sub, rotate } from '../src/geometry';
import { POCKETS } from '../src/table';
import { generatePuzzle } from '../src/generator';
import { shotGeometry } from '../src/shots';
import { INTERMEDIATE } from '../src/skill';
import { zoneContext, zoneValue } from '../src/zone';

const skill = INTERMEDIATE;
const puzzle = generatePuzzle(663545194, 3, skill)!;
const [b7, b8, b9] = puzzle.layout.balls;
const others = [b8.pos, b9.pos];

const angles = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
const dists = [10, 16, 24, 34];

for (const pocket of POCKETS) {
  const zc = zoneContext(b7.pos, pocket, others);
  if (!zc.ballPathClear) continue;
  const aim = norm(sub(pocket.target, b7.pos));
  const aimBack = scale(aim, -1);
  const ghost = add(b7.pos, scale(aimBack, 2 * 1.125));
  const rows: { aDeg: number; d: number; v: number; x: number; y: number }[] = [];
  for (const aDeg of angles) {
    for (const d of dists) {
      const c = add(ghost, scale(rotate(aimBack, (aDeg * Math.PI) / 180), d));
      const v = zoneValue(c, zc, skill);
      if (v < 0.35) continue;
      const g = shotGeometry(c, b7.pos, pocket);
      if (!g) continue;
      rows.push({ aDeg, d, v, x: c.x, y: c.y });
    }
  }
  rows.sort((a, b) => b.v - a.v);
  console.log(`\npocket ${pocket.id}: ${rows.length} placements, top 12 kept:`);
  rows.forEach((r, i) => {
    const kept = i < 12 ? 'KEEP' : 'cut ';
    const mark = r.aDeg === 30 && r.d === 10 ? '  <-- user placement' : '';
    console.log(
      `${kept} #${String(i + 1).padStart(2)} a=${String(r.aDeg).padStart(3)} d=${r.d} v=${r.v.toFixed(4)} cue(${r.x.toFixed(1)},${r.y.toFixed(1)})${mark}`,
    );
  });
}
