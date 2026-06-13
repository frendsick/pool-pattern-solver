// Render the user's preferred image-#31 plan (5 -> TS, ~13 deg cut, follow
// one rail off the top, down along the 6's window) as a step-2 diagram, by
// continuing the beam from the fold child alone. For visual comparison with
// the solver's chosen plan.

import { writeFileSync, mkdirSync } from 'node:fs';
import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import {
  initialNodes, expandNodes, zoneTargets, Pattern, PlannedShot,
} from '../src/solver';
import { surfacesForLayout, gateFor } from '../src/value';
import { sceneForStep } from '../src/scene';
import { renderScene } from '../src/render';

const layout: Layout = {
  seed: 0,
  balls: [
    { num: 5, pos: vec(56.35, 15.72) },
    { num: 6, pos: vec(93.8, 19.07) },
    { num: 7, pos: vec(76.97, 19.82) },
    { num: 8, pos: vec(39.26, 25.78) },
    { num: 9, pos: vec(49.47, 24.93) },
  ],
};
const surfaces = surfacesForLayout(layout, INTERMEDIATE);
const targets = zoneTargets(
  layout.balls[1], layout.balls.slice(2), INTERMEDIATE, gateFor(surfaces, 2),
);
let nodes = initialNodes(layout, INTERMEDIATE, gateFor(surfaces, 1), targets);
nodes = expandNodes(nodes, layout.balls[1], layout.balls.slice(2), INTERMEDIATE, gateFor(surfaces, 2));
let fold = nodes.filter((n) => {
  const s = n.done[0];
  return s.pocket.id === 'TS' && s.rails >= 1 && s.cutDeg < 25 && s.type === 'follow';
});
for (let k = 2; k < layout.balls.length && fold.length > 0; k++) {
  fold = expandNodes(fold, layout.balls[k], layout.balls.slice(k + 1), INTERMEDIATE, gateFor(surfaces, k + 1));
}
if (fold.length === 0) { console.log('no fold chain'); process.exit(1); }
const n = fold[0];
const p = n.pending;
const last: PlannedShot = {
  ball: p.ball, pocket: p.pocket, cuePos: p.cuePos, ghost: p.g.ghost,
  cutDeg: (p.g.cut * 180) / Math.PI, potProb: p.potProb,
  type: null, path: null, landing: null, rails: 0, travel: 0,
  eNext: null, windowRef: null, zoneLen: null, entryDeg: null, explanation: '',
};
const pattern: Pattern = { shots: [...n.done, last], score: n.score };
for (const s of pattern.shots) {
  console.log(
    `${s.ball.num} -> ${s.pocket.id} cut ${s.cutDeg.toFixed(0)} ${s.type ?? 'finish'}` +
    (s.type ? ` t ${s.travel.toFixed(0)}" r${s.rails} e ${s.eNext?.toFixed(3)}` : ` pot ${s.potProb.toFixed(3)}`),
  );
}
console.log(`fold plan score: ${pattern.score.toFixed(3)}`);
mkdirSync('/tmp/pps-snapshots', { recursive: true });
writeFileSync(
  '/tmp/pps-snapshots/i31-fold-step2.svg',
  renderScene(sceneForStep(layout, pattern, 2, INTERMEDIATE)),
);
console.log('wrote /tmp/pps-snapshots/i31-fold-step2.svg');
