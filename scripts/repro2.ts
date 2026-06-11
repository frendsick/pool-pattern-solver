// Repro of the second annotated screenshot: landing outside the drawn window.
import { writeFileSync, mkdirSync } from 'node:fs';
import { Layout } from '../src/table';
import { vec, dist } from '../src/geometry';
import { solve } from '../src/solver';
import { INTERMEDIATE } from '../src/skill';
import { sceneForStep } from '../src/scene';
import { renderScene } from '../src/render';
import { zoneContext, zoneValue, zoneBar, zonePeak } from '../src/zone';
import { POCKETS } from '../src/table';

const layout: Layout = {
  balls: [
    { num: 7, pos: vec(77.9, 10.8) },
    { num: 8, pos: vec(53.0, 25.5) },
    { num: 9, pos: vec(30.2, 19.7) },
  ],
  seed: 0,
};
const pattern = solve(layout, INTERMEDIATE)!;
mkdirSync('/tmp/pps-repro2', { recursive: true });
for (let s = 0; s <= pattern.shots.length + 1; s++) {
  const svg = renderScene(sceneForStep(layout, pattern, s, INTERMEDIATE));
  writeFileSync(`/tmp/pps-repro2/step${s}.svg`, svg);
}
for (const sh of pattern.shots) console.log(sh.explanation);
console.log('score:', pattern.score.toFixed(3));

// Diagnose: value of the shot-1 landing inside the DISPLAYED zone for the 8.
const s1 = pattern.shots[0];
const s2 = pattern.shots[1];
const nextZones = POCKETS.map((p) => zoneContext(layout.balls[2].pos, p, [])).filter(
  (z) => z.ballPathClear,
);
const zc = zoneContext(s2.ball.pos, s2.pocket, [layout.balls[2].pos], nextZones);
console.log('shot2 pocket:', s2.pocket.id, ' landing:', JSON.stringify(s1.landing));
console.log('zonePeak:', zonePeak(zc, INTERMEDIATE).toFixed(3),
  ' bar:', zoneBar(zc, INTERMEDIATE).toFixed(3),
  ' v(landing):', zoneValue(s1.landing!, zc, INTERMEDIATE).toFixed(3),
  ' dist(landing,8):', dist(s1.landing!, s2.ball.pos).toFixed(1));
