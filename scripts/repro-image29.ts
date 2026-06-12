// Round 17 (2026-06-12, image #29): balls 7 (43.4, 5.4) hanging ~8.5" off the
// bottom side pocket, 8 (18.8, 9.9), 9 (45.5, 13.8); ball in hand. The solver
// placed the cue at ~(54.6, 10.3) and played 7 LONG to the bottom-left corner
// off the bottom rail, then a near-straight 8 with draw back up-table, 9 to
// the bottom side (66%). User: pot the hanging 7 into the SIDE with a stop
// shot / short draw to the middle, then 8 with follow one rail or stun two
// rails back toward the 9, 9 to the middle.
// Layout recovered via pocket-anchored pixel mapping (15.12 px/inch).

import { writeFileSync, mkdirSync } from 'node:fs';
import { vec, add, scale, norm, sub, Vec } from '../src/geometry';
import { Layout, POCKETS, pocketById, PocketId, Ball } from '../src/table';
import {
  INTERMEDIATE, routeReliability, powerFactor, potProbability, distanceSigma,
} from '../src/skill';
import { solve, expectedNextPot } from '../src/solver';
import { zoneContext, zoneValue } from '../src/zone';
import {
  shotGeometry, departureDir, caromCurve, minCueTravel, tracePath, hitDistance,
} from '../src/shots';
import { sceneForStep } from '../src/scene';
import { renderScene } from '../src/render';

const layout: Layout = {
  seed: 0,
  balls: [
    { num: 7, pos: vec(43.4, 5.4) },
    { num: 8, pos: vec(18.8, 9.9) },
    { num: 9, pos: vec(45.5, 13.8) },
  ],
};
const [sevenB, eightB, nineB] = layout.balls;

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
    `/tmp/pps-snapshots/i29-step${st}.svg`,
    renderScene(sceneForStep(layout, pattern, st, INTERMEDIATE)),
  );
}

// ---------------------------------------------------------------------------
// Evaluate one shot from a given cue position: pot prob, and per pocket/type
// the best route into the next ball's (onward-gated) zone, exactly as
// expandPass prices it: e = expectedNextPot * ease.
function gatedZone(nextBall: Ball, pid: PocketId, later: Ball[], after: Ball | null) {
  const nextZones = after
    ? POCKETS.map((p) => zoneContext(after.pos, p, [])).filter((z) => z.ballPathClear)
    : [];
  return zoneContext(nextBall.pos, pocketById(pid), later.map((b) => b.pos), nextZones);
}

function evalShot(
  label: string,
  cue: Vec,
  ball: Ball,
  pid: PocketId,
  nextBall: Ball,
  later: Ball[],
  after: Ball | null,
  nextPids: PocketId[],
) {
  const pocket = pocketById(pid);
  const g = shotGeometry(cue, ball.pos, pocket);
  if (!g) { console.log(`${label}: NO GEOMETRY`); return; }
  const pot = potProbability(g, pocket, INTERMEDIATE);
  console.log(
    `${label}: ${ball.num}->${pid} cue (${cue.x.toFixed(1)},${cue.y.toFixed(1)})` +
      ` cut ${((g.cut * 180) / Math.PI).toFixed(1)} deg, dCueGhost ${g.dCueGhost.toFixed(1)}", pot ${pot.toFixed(3)}`,
  );
  const obstacles = [nextBall.pos, ...later.map((b) => b.pos)];
  for (const nextPid of nextPids) {
    const zc = gatedZone(nextBall, nextPid, later, after);
    if (!zc.ballPathClear) { console.log(`  next ${nextBall.num}->${nextPid}: blocked`); continue; }
    // stop
    if (g.cut < (9 * Math.PI) / 180) {
      const e =
        expectedNextPot(g.ghost, g.aim, 0.5, 'stop', 0, obstacles, zc, INTERMEDIATE,
          g.dCueGhost, { g, pocket }) * INTERMEDIATE.typeReliability.stop;
      console.log(`  next ${nextBall.num}->${nextPid}: stop  e ${e.toFixed(3)} land (${g.ghost.x.toFixed(1)},${g.ghost.y.toFixed(1)})`);
    }
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
          `  next ${nextBall.num}->${nextPid}: ${type.padEnd(8)} e ${best.e.toFixed(3)}` +
            ` travel ${best.t}" rails ${best.rails} land (${best.end.x.toFixed(1)},${best.end.y.toFixed(1)})`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== plan B (user): 7 -> bottom side, stop / short draw ===');
// Straight placement on the BS line (stop shot leaves the cue at the ghost),
// and fuller placements that allow a short draw back to the middle.
const aimBS = norm(sub(pocketById('BS').target, sevenB.pos));
const ghostBS = sub(sevenB.pos, scale(aimBS, 2.25));
for (const d of [10, 16, 24]) {
  evalShot(`B straight d=${d}`, add(ghostBS, scale(aimBS, -d)), sevenB, 'BS', eightB, [nineB], nineB, ['BL']);
}
// Angled placements (cue more to the right -> draw pulls back toward middle).
for (const cue of [vec(50, 16), vec(52, 13), vec(48, 19), vec(45, 22)]) {
  evalShot(`B angled`, cue, sevenB, 'BS', eightB, [nineB], nineB, ['BL']);
}

console.log('\n=== plan B shot 2: 8 -> BL from mid-table, onward to the 9 ===');
for (const cue of [vec(41.7 - 2.25 * aimBS.x, 6.85 - 2.25 * aimBS.y), ghostBS, vec(35, 12), vec(38, 10), vec(32, 15)]) {
  evalShot(`B2 from (${cue.x.toFixed(0)},${cue.y.toFixed(0)})`, cue, eightB, 'BL', nineB, [], null, ['BS', 'TS']);
}

console.log('\n=== solver shot 1 re-eval (7 -> BL from its placement) ===');
const s1 = pattern.shots[0];
evalShot('A', s1.cuePos, sevenB, s1.pocket.id as PocketId, eightB, [nineB], nineB, ['BL']);
