// JAW_RANGE 6 -> 9 made seed 63's shot-1 landing fall outside the drawn
// polygons while its value clears the bar. Find out why.
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { POCKETS } from '../src/table';
import { vec, add, scale, norm, sub, dist } from '../src/geometry';
import { zoneContext, zoneBar, zoneValue, zonePeak, zonePolygons, zoneGhost } from '../src/zone';

const puzzle = generatePuzzle(63, 3, INTERMEDIATE)!;
const { layout, pattern } = puzzle;
console.log('balls:', layout.balls.map((b) => `${b.num} (${b.pos.x.toFixed(1)},${b.pos.y.toFixed(1)})`).join('  '));
const shot = pattern.shots[0];
const next = pattern.shots[1];
console.log(`shot1 ${shot.ball.num}->${shot.pocket.id} ${shot.type} landing (${shot.landing!.x.toFixed(1)},${shot.landing!.y.toFixed(1)}) windowRef ${shot.windowRef?.toFixed(3)}`);
console.log(`shot2 ${next.ball.num}->${next.pocket.id}`);

const later = layout.balls.slice(2).map((b) => b.pos);
const after = layout.balls[2] ?? null;
const nextZones = after
  ? POCKETS.map((p) => zoneContext(after.pos, p, [])).filter((z) => z.ballPathClear)
  : [];
const zc = zoneContext(next.ball.pos, next.pocket, later, nextZones);
const cap = shot.windowRef ?? Infinity;
const bar = zoneBar(zc, INTERMEDIATE, 0, cap);
const peak = zonePeak(zc, INTERMEDIATE);
console.log(`peak ${peak.toFixed(3)} cap ${cap.toFixed(3)} bar ${bar.toFixed(3)} v(landing) ${zoneValue(shot.landing!, zc, INTERMEDIATE).toFixed(3)}`);

const polys = zonePolygons(zc, INTERMEDIATE, 0, 85, cap);
console.log(`polygons: ${polys.length}, sizes: ${polys.map((p) => p.length).join(',')}`);

// walk the ray from the zone ghost through the landing
const ghost = zoneGhost(zc);
const dir = norm(sub(shot.landing!, ghost));
console.log(`ghost (${ghost.x.toFixed(1)},${ghost.y.toFixed(1)}), landing at r=${dist(ghost, shot.landing!).toFixed(1)}`);
for (let r = 2; r <= 90; r += 4) {
  const p = add(ghost, scale(dir, r));
  console.log(`  r=${r} (${p.x.toFixed(1)},${p.y.toFixed(1)}) v=${zoneValue(p, zc, INTERMEDIATE).toFixed(3)}${r >= dist(ghost, shot.landing!) - 2 && r < dist(ghost, shot.landing!) + 2 ? '  <- landing' : ''}`);
}

// buildPies-style ray: from the BALL toward the landing
const dirB = norm(sub(shot.landing!, next.ball.pos));
console.log('--- ray from ball through landing ---');
for (let r = 2.55; r <= 60; r += 1.5) {
  const p = add(next.ball.pos, scale(dirB, r));
  const v = zoneValue(p, zc, INTERMEDIATE);
  console.log(`  r=${r.toFixed(1)} (${p.x.toFixed(1)},${p.y.toFixed(1)}) v=${v.toFixed(3)}${v >= bar ? ' IN' : ''}`);
}
