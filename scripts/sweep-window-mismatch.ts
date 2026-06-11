// Sweep generated puzzles: how often does a shot's planned landing fall
// OUTSIDE the position window the user sees (scene.ts onward-control zone /
// its drawn polygon), even though the route search accepted it against its
// own pot-only zone? Quantifies the 2026-06-11 screenshot report.

import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { POCKETS } from '../src/table';
import { Vec } from '../src/geometry';
import { zoneContext, zoneBar, zoneValue, zonePeak, zonePolygons } from '../src/zone';

function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

let shotsChecked = 0;
let outsideValue = 0; // landing below the displayed zone's bar
let outsidePoly = 0; // landing inside no drawn polygon (primary or alt)
const examples: string[] = [];

for (let seed = 1; seed <= 80; seed++) {
  const puzzle = generatePuzzle(seed, 3, INTERMEDIATE);
  if (!puzzle) continue;
  const { layout, pattern } = puzzle;
  for (let k = 1; k < pattern.shots.length; k++) {
    const shot = pattern.shots[k - 1];
    const next = pattern.shots[k];
    if (!shot.landing) continue;
    shotsChecked++;

    // scene.ts displayed-zone construction for step s = k + 1
    const later = layout.balls.slice(k + 1).map((b) => b.pos);
    const after = layout.balls[k + 1] ?? null;
    const afterObstacles = layout.balls.slice(k + 2).map((b) => b.pos);
    const nextZones = after
      ? POCKETS.map((p) => zoneContext(after.pos, p, afterObstacles)).filter(
          (z) => z.ballPathClear,
        )
      : [];
    const primary = zoneContext(next.ball.pos, next.pocket, later, nextZones);
    const cap = shot.windowRef ?? Infinity;
    const bar = zoneBar(primary, INTERMEDIATE, 0, cap);
    const v = zoneValue(shot.landing, primary, INTERMEDIATE);

    const polys: Vec[][] = zonePolygons(primary, INTERMEDIATE, 0, 85, cap);
    const ref = Math.min(zonePeak(primary, INTERMEDIATE), cap);
    let bestAlt: Vec[][] | null = null;
    const area = (list: Vec[][]) => {
      let total = 0;
      for (const poly of list) {
        let a = 0;
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i];
          const q = poly[(i + 1) % poly.length];
          a += p.x * q.y - q.x * p.y;
        }
        total += Math.abs(a) / 2;
      }
      return total;
    };
    for (const p of POCKETS) {
      if (p.id === next.pocket.id) continue;
      const alt = zonePolygons(
        zoneContext(next.ball.pos, p, later, nextZones), INTERMEDIATE, ref, 85, cap,
      );
      if (alt.length > 0 && (!bestAlt || area(alt) > area(bestAlt))) bestAlt = alt;
    }
    if (bestAlt) polys.push(...bestAlt);

    const inPoly = polys.some((poly) => pointInPolygon(shot.landing!, poly));
    const belowBar = v < bar;
    if (belowBar) outsideValue++;
    if (!inPoly) outsidePoly++;
    if ((belowBar || !inPoly) && examples.length < 10) {
      examples.push(
        `seed ${seed} shot ${k}: ${shot.ball.num}->${shot.pocket.id} ${shot.type}, ` +
          `landing (${shot.landing.x.toFixed(1)}, ${shot.landing.y.toFixed(1)}), ` +
          `displayed v=${v.toFixed(3)} bar=${bar.toFixed(3)}${belowBar ? ' BELOW-BAR' : ''}${!inPoly ? ' NOT-IN-POLYGON' : ''}`,
      );
    }
  }
}

console.log(`shots checked: ${shotsChecked}`);
console.log(`landing below displayed bar: ${outsideValue} (${((100 * outsideValue) / shotsChecked).toFixed(0)}%)`);
console.log(`landing outside all drawn polygons: ${outsidePoly} (${((100 * outsidePoly) / shotsChecked).toFixed(0)}%)`);
console.log(examples.join('\n'));
