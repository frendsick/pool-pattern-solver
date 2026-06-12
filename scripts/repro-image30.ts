// Round 19 (2026-06-12, image #30): balls 5 (88.3, 15.9), 6 (35.9, 23.7),
// 7 (6.9, 37.4), 8 (21.2, 26.0), 9 (41.5, 18.9); ball in hand. The solver
// placed the cue at ~(85.8, 27.7) and played the 5 to the BOTTOM-RIGHT
// corner, follow off the bottom rail UP into the 6's window — crossing it
// (4" of path inside, position 65%). User: shoot the 5 to the TOP-RIGHT
// corner with follow one rail (top rail), so the cue ball comes down ALONG
// the window's long axis (the 6 -> BL line) instead of across it.
// Layout recovered via diamond-anchored pixel mapping (15.12 px/inch).

import { writeFileSync, mkdirSync } from 'node:fs';
import { vec, add, scale, norm, sub, rotate, Vec } from '../src/geometry';
import { Layout, POCKETS, pocketById, PocketId, Ball } from '../src/table';
import {
  INTERMEDIATE, routeReliability, powerFactor, potProbability, distanceSigma,
} from '../src/skill';
import { solve, expectedNextPot } from '../src/solver';
import { zoneContext, zoneValue } from '../src/zone';
import {
  shotGeometry, departureDir, caromCurve, minCueTravel, tracePath, hitDistance,
} from '../src/shots';
import { surfacesForLayout, gateFor } from '../src/value';
import { sceneForStep } from '../src/scene';
import { renderScene } from '../src/render';

const layout: Layout = {
  seed: 0,
  balls: [
    { num: 5, pos: vec(88.3, 15.9) },
    { num: 6, pos: vec(35.9, 23.7) },
    { num: 7, pos: vec(6.9, 37.4) },
    { num: 8, pos: vec(21.2, 26.0) },
    { num: 9, pos: vec(41.5, 18.9) },
  ],
};
const [fiveB, sixB, sevenB, eightB, nineB] = layout.balls;
const surfaces = surfacesForLayout(layout, INTERMEDIATE);

console.log('=== solver plan ===');
const pattern = solve(layout, INTERMEDIATE);
if (!pattern) {
  console.log('NO PATTERN');
  process.exit(1);
}
for (const s of pattern.shots) {
  console.log(
    `${s.ball.num} -> ${s.pocket.id}  cue (${s.cuePos.x.toFixed(1)}, ${s.cuePos.y.toFixed(1)})` +
      ` cut ${s.cutDeg.toFixed(0)} deg pot ${s.potProb.toFixed(3)}` +
      (s.type ? ` ${s.type} travel ${s.travel.toFixed(0)}" rails ${s.rails} eNext ${s.eNext?.toFixed(3)}` : '') +
      (s.landing ? ` -> (${s.landing.x.toFixed(1)}, ${s.landing.y.toFixed(1)})` : ''),
  );
  console.log(`   ${s.explanation}`);
}
console.log(`score: ${pattern.score.toFixed(3)}`);

mkdirSync('/tmp/pps-snapshots', { recursive: true });
for (let st = 0; st <= pattern.shots.length + 1; st++) {
  writeFileSync(
    `/tmp/pps-snapshots/i30-step${st}.svg`,
    renderScene(sceneForStep(layout, pattern, st, INTERMEDIATE)),
  );
}

// ---------------------------------------------------------------------------
// Evaluate shot 1 (the 5, ball in hand) from a given cue position into a
// given pocket, pricing every route into the 6's onward-gated zones exactly
// as expandPass does: e = expectedNextPot * ease.
function evalShot(label: string, cue: Vec, pid: PocketId, nextPids: PocketId[]) {
  const pocket = pocketById(pid);
  const g = shotGeometry(cue, fiveB.pos, pocket);
  if (!g) { console.log(`${label}: NO GEOMETRY`); return; }
  const pot = potProbability(g, pocket, INTERMEDIATE);
  console.log(
    `${label}: 5->${pid} cue (${cue.x.toFixed(1)},${cue.y.toFixed(1)})` +
      ` cut ${((g.cut * 180) / Math.PI).toFixed(1)} deg, dCueGhost ${g.dCueGhost.toFixed(1)}", pot ${pot.toFixed(3)}`,
  );
  const later = [sevenB, eightB, nineB];
  const obstacles = [sixB.pos, ...later.map((b) => b.pos)];
  for (const nextPid of nextPids) {
    const zc = zoneContext(
      sixB.pos, pocketById(nextPid), later.map((b) => b.pos), [],
      gateFor(surfaces, 2),
    );
    if (!zc.ballPathClear) { console.log(`  next 6->${nextPid}: blocked`); continue; }
    for (const type of ['follow', 'stun', 'lowTouch', 'draw'] as const) {
      const dir = departureDir(g, type);
      if (!dir) continue;
      let best = { e: 0, t: 0, end: vec(0, 0), rails: 0 };
      for (let t = Math.max(1, minCueTravel(g, type)); t <= 220; t += 2) {
        const curve = caromCurve(g, type, t) ?? undefined;
        const tr = tracePath(g.ghost, dir, t, obstacles, 4, curve);
        if (tr.outcome !== 'ok') continue;
        const ease =
          routeReliability(type, g.dCueGhost, INTERMEDIATE) *
          powerFactor(hitDistance(g, type, t), INTERMEDIATE);
        const e =
          expectedNextPot(g.ghost, dir, t, type, tr.rails, obstacles, zc,
            INTERMEDIATE, g.dCueGhost, { g, pocket }, curve) * ease;
        if (e > best.e) best = { e, t, end: tr.end, rails: tr.rails };
      }
      if (best.e > 0.02) {
        console.log(
          `  next 6->${nextPid}: ${type.padEnd(8)} e ${best.e.toFixed(3)}` +
            ` travel ${best.t}" rails ${best.rails} land (${best.end.x.toFixed(1)},${best.end.y.toFixed(1)})`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== plan B (user): 5 -> TR, follow one rail along the window ===');
// Cue below/right of the 5 so the follow carom heads to the TOP rail and
// folds back down the 6->BL line. Sweep the initialNodes-style placements.
const aimTR = norm(sub(pocketById('TR').target, fiveB.pos));
const ghostTR = sub(fiveB.pos, scale(aimTR, 2.25));
for (const aDeg of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
  for (const d of [10, 16, 24, 34]) {
    const cue = add(ghostTR, scale(rotate(scale(aimTR, -1), (aDeg * Math.PI) / 180), d));
    const g = shotGeometry(cue, fiveB.pos, pocketById('TR'));
    if (!g) continue;
    const pot = potProbability(g, pocketById('TR'), INTERMEDIATE);
    if (pot < 0.35) continue;
    evalShot(`B a=${aDeg} d=${d}`, cue, 'TR', ['BL']);
  }
}

console.log('\n=== solver shot 1 re-eval (5 -> BR from its placement) ===');
const s1 = pattern.shots[0];
evalShot('A', s1.cuePos, s1.pocket.id as PocketId, ['BL', 'TL', 'BS']);
