// Mirror initialNodes for the side-hanger layout: gated vs ungated placement
// values for the 7 into BS vs BL, to see which stage loses the BS pattern.
import { add, norm, rotate, scale, sub, vec } from '../src/geometry';
import { Layout, POCKETS, pocketById } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { zoneContext, zoneValue } from '../src/zone';
import { buildSurfaces, gateFor } from '../src/value';

const balls = [
  { num: 7, pos: vec(43.4, 5.4) },
  { num: 8, pos: vec(18.8, 9.9) },
  { num: 9, pos: vec(45.5, 13.8) },
];
const others = balls.slice(1).map((b) => b.pos);
const surfaces = buildSurfaces(balls, INTERMEDIATE);
const gate = gateFor(surfaces, 1)!;
console.log('V1 peak', surfaces[1]!.peak.toFixed(3), ' V2 peak', surfaces[2]!.peak.toFixed(3));

const angles = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
const dists = [10, 16, 24, 34];
for (const pid of ['BS', 'BL']) {
  const pocket = pocketById(pid);
  const zc = zoneContext(balls[0].pos, pocket, others);
  const zcGated = zoneContext(balls[0].pos, pocket, others, [], gate);
  const aim = norm(sub(pocket.target, balls[0].pos));
  const aimBack = scale(aim, -1);
  const ghost = add(balls[0].pos, scale(aimBack, 2.25));
  const rows: { c: string; v: number; sel: number }[] = [];
  for (const aDeg of angles) for (const d of dists) {
    const c = add(ghost, scale(rotate(aimBack, (aDeg * Math.PI) / 180), d));
    const v = zoneValue(c, zc, INTERMEDIATE);
    if (v < 0.35) continue;
    rows.push({ c: `(${c.x.toFixed(0)},${c.y.toFixed(0)}) a${aDeg} d${d}`, v, sel: zoneValue(c, zcGated, INTERMEDIATE) });
  }
  rows.sort((a, b) => b.sel - a.sel);
  console.log(`\n${pid}: ${rows.length} placements pass the pot floor`);
  for (const r of rows.slice(0, 6)) console.log(`  ${r.c}  pot ${r.v.toFixed(3)}  gated ${r.sel.toFixed(3)}`);
}
