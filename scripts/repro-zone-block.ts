// Repro of the zone-occlusion feedback (2026-06-12, image #25): the drawn
// position window for the 8 covers cue positions from which the 9 blocks the
// shot on the 8. zoneValue is 0 there (cuePathClear rejects them) — the bug
// is in zonePolygon's pie builder, which skips fully-blocked rays and lets
// the outline bridge straight across the 9's shadow wedge.

import { writeFileSync, mkdirSync } from 'node:fs';
import { vec, add, scale, norm, sub, dist, Vec } from '../src/geometry';
import { Layout, POCKETS, BALL_R } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';
import { sceneForStep } from '../src/scene';
import { renderScene } from '../src/render';
import { zoneContext, zoneValue, zonePolygons } from '../src/zone';

// Image #25 px -> inches (15.12 px/inch, mapped via the corner pockets).
const layout: Layout = {
  seed: 0,
  balls: [
    { num: 7, pos: vec(13.3, 22.7) },
    { num: 8, pos: vec(41.6, 34.3) },
    { num: 9, pos: vec(36.6, 26.8) },
  ],
};

const pattern = solve(layout, INTERMEDIATE);
if (!pattern) {
  console.log('NO PATTERN FOUND');
  process.exit(1);
}
for (const s of pattern.shots) {
  console.log(s.explanation);
  if (s.landing) {
    console.log(
      `   cue (${s.cuePos.x.toFixed(1)}, ${s.cuePos.y.toFixed(1)})` +
        ` -> landing (${s.landing.x.toFixed(1)}, ${s.landing.y.toFixed(1)})`,
    );
  }
}

mkdirSync('/tmp/pps-snapshots', { recursive: true });
for (let st = 0; st <= pattern.shots.length + 1; st++) {
  const svg = renderScene(sceneForStep(layout, pattern, st, INTERMEDIATE));
  writeFileSync(`/tmp/pps-snapshots/zb-step${st}.svg`, svg);
}

// Rebuild the step-2 zone exactly as scene.ts does and audit it: every point
// inside the drawn polygon must have zoneValue > 0 (in particular, must not
// be blocked by the 9).
const next = pattern.shots[1];
const eight = layout.balls[1].pos;
const nine = layout.balls[2].pos;
const after = layout.balls[2];
const nextZones = POCKETS.map((p) => zoneContext(after.pos, p, [])).filter(
  (z) => z.ballPathClear,
);
const zc = zoneContext(eight, next.pocket, [nine], nextZones);
const cap = pattern.shots[0].windowRef ?? Infinity;
const polys = zonePolygons(zc, INTERMEDIATE, 0, 85, cap);
console.log(`next pocket: ${next.pocket.id}, polygons: ${polys.length}`);

function inAnyPoly(p: Vec, polys: Vec[][]): boolean {
  return polys.some((poly) => inPoly(p, poly));
}

function inPoly(p: Vec, poly: Vec[]): boolean {
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

let covered = 0;
let blocked = 0;
const offenders: Vec[] = [];
for (let x = 0; x <= 100; x += 0.5) {
  for (let y = 0; y <= 50; y += 0.5) {
    const p = vec(x, y);
    if (!inAnyPoly(p, polys)) continue;
    covered++;
    if (zoneValue(p, zc, INTERMEDIATE) <= 0) {
      blocked++;
      offenders.push(p);
    }
  }
}
console.log(`polygon grid points: ${covered}, with zoneValue 0: ${blocked}`);
if (offenders.length) {
  console.log('sample dead points inside drawn zone:');
  for (const p of offenders.filter((_, i) => i % 25 === 0).slice(0, 10)) {
    console.log(`  (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
  }
}

// Direct check along the 9's shadow: points on the ghost->9 line extended.
const aim = norm(sub(next.pocket.target, eight));
const ghost = sub(eight, scale(aim, 2 * BALL_R));
const shadowDir = norm(sub(nine, ghost));
for (let r = dist(ghost, nine) + 2 * BALL_R + 1; r <= 30; r += 4) {
  const p = add(ghost, scale(shadowDir, r));
  console.log(
    `shadow r=${r.toFixed(0)}": (${p.x.toFixed(1)}, ${p.y.toFixed(1)})` +
      ` inPoly=${inAnyPoly(p, polys)} zoneValue=${zoneValue(p, zc, INTERMEDIATE).toFixed(3)}`,
  );
}
