// Measure, per shot of a solved pattern, what share of the post-contact path
// lies inside / near / far-outside the NEXT ball's position window. Used to
// calibrate an in-window-path preference that flips seed 775832494 shot 7
// (a 47" follow, ~45% out of window) WITHOUT punishing routes the user wants
// (e.g. the round-21 handball long follow, the round-19 along-window follow).

import { Layout, BALL_R } from '../src/table';
import { vec, dist, norm, sub } from '../src/geometry';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';
import { shotGeometry, tracePath, caromCurve } from '../src/shots';
import { surfacesForLayout, gateFor } from '../src/value';
import { zoneTargets, routeCandidates } from '../src/route';
import { zoneValue, zoneContext } from '../src/zone';

type Vec = { x: number; y: number };

function shares(path: Vec[] | null, zc: any): { inP: number; nearP: number; outLen: number; total: number } {
  if (!path || path.length < 2) return { inP: 1, nearP: 1, outLen: 0, total: 0 };
  const STEP = 1.0;
  let total = 0, inLen = 0, nearLen = 0, outLen = 0;
  for (let k = 0; k + 1 < path.length; k++) {
    const segLen = dist(path[k], path[k + 1]);
    const d = norm(sub(path[k + 1], path[k]));
    const n = Math.max(1, Math.ceil(segLen / STEP));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) * (segLen / n);
      const p = vec(path[k].x + d.x * t, path[k].y + d.y * t);
      const v = zoneValue(p, zc, INTERMEDIATE);
      const dl = segLen / n;
      total += dl;
      if (v >= 0.6) inLen += dl;
      if (v >= 0.3) nearLen += dl; else outLen += dl;
    }
  }
  return { inP: inLen / total, nearP: nearLen / total, outLen, total };
}

function report(name: string, layout: Layout) {
  const skill = INTERMEDIATE;
  const surfaces = surfacesForLayout(layout, skill);
  const p = solve(layout, skill);
  if (!p) { console.log(`${name}: no solve`); return; }
  console.log(`\n${name}  (score ${p.score.toFixed(4)})`);
  for (let i = 0; i < p.shots.length - 1; i++) {
    const s = p.shots[i];
    const next = p.shots[i + 1];
    const later = p.shots.slice(i + 2).map((x) => x.ball.pos);
    const zc = zoneContext(next.ball.pos, next.pocket, later, [], gateFor(surfaces, i + 2));
    const sh = shares(s.path, zc);
    console.log(
      `  shot${i + 1} pot ${s.ball.num}->${s.pocket.id} ${s.type}/${s.travel?.toFixed(0)}"/${s.rails}r len=${sh.total.toFixed(0).padStart(3)}"` +
        `  in=${(100 * sh.inP).toFixed(0).padStart(3)}% near=${(100 * sh.nearP).toFixed(0).padStart(3)}% farOutLen=${sh.outLen.toFixed(0)}"`,
    );
  }
}

report('775832494 n=9 (shot7 should go in-window)', {
  seed: 775832494, balls: [
    { num: 1, pos: vec(40.3, 14.3) }, { num: 2, pos: vec(17.1, 10.7) },
    { num: 3, pos: vec(61.9, 8.4) }, { num: 4, pos: vec(49.9, 5.8) },
    { num: 5, pos: vec(52.6, 41.1) }, { num: 6, pos: vec(47.2, 37.4) },
    { num: 7, pos: vec(55.4, 16.9) }, { num: 8, pos: vec(77.2, 13.1) },
    { num: 9, pos: vec(25.4, 5.1) } ] });

report('handball-long-follow 791175205 (WANTED long follow)', {
  seed: 791175205, balls: [
    { num: 5, pos: vec(75.31, 10.94) }, { num: 6, pos: vec(9.64, 23.86) },
    { num: 7, pos: vec(41.62, 28.54) }, { num: 8, pos: vec(94.99, 11.98) },
    { num: 9, pos: vec(32.10, 46.26) } ] });

report('along-window image#30 (WANTED along-window follow)', {
  seed: 0, balls: [
    { num: 5, pos: vec(88.3, 15.9) }, { num: 6, pos: vec(35.9, 23.7) },
    { num: 7, pos: vec(6.9, 37.4) }, { num: 8, pos: vec(21.2, 26.0) },
    { num: 9, pos: vec(41.5, 18.9) } ] });

report('simpler-routes 349500940', {
  seed: 349500940, balls: [
    { num: 5, pos: vec(56.86, 15.69) }, { num: 6, pos: vec(95.0, 19.10) },
    { num: 7, pos: vec(77.85, 19.85) }, { num: 8, pos: vec(38.49, 24.95) },
    { num: 9, pos: vec(49.84, 25.07) } ] });
