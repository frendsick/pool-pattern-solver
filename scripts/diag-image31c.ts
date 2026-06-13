// Image #31, part 3: step the beam. Which ball-in-hand seeds exist for the
// 5 (aligned ones included), which step-1 children do they produce, and how
// do the user's rail-fold candidates (5 -> TS, ~12-18 deg cut, one rail off
// the top) rank against the chosen plan after each layer?

import { vec, sub, norm, dist } from '../src/geometry';
import { Layout, pocketById } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { initialNodes, expandNodes, Node, zoneTargets } from '../src/solver';
import { surfacesForLayout, gateFor } from '../src/value';

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
const targets2 = zoneTargets(
  layout.balls[1], layout.balls.slice(2), INTERMEDIATE, gateFor(surfaces, 2),
);
let nodes = initialNodes(layout, INTERMEDIATE, gateFor(surfaces, 1), targets2);

console.log(`=== ${nodes.length} initial seeds ===`);
const seen = new Map<string, number>();
for (const n of nodes) {
  const g = n.pending.g;
  // signed angle of the placement relative to straight-in
  const aim = g.aim;
  const cueDir = g.cueDir;
  const side = aim.x * cueDir.y - aim.y * cueDir.x >= 0 ? 1 : -1;
  const cut = (g.cut * 180) / Math.PI;
  const key = `${n.pending.pocket.id} ${side * Math.round(cut)}`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
}
console.log([...seen.entries()].map(([k, c]) => `${k}(x${c})`).join('  '));

for (let k = 1; k < layout.balls.length; k++) {
  nodes = expandNodes(
    nodes, layout.balls[k], layout.balls.slice(k + 1), INTERMEDIATE,
    gateFor(surfaces, k + 1),
  );
  console.log(`\n=== layer ${k} (${nodes.length} nodes) ===`);
  for (const [i, n] of nodes.slice(0, 12).entries()) {
    const s = n.done[n.done.length - 1];
    console.log(
      `#${String(i).padStart(2)} score ${n.score.toFixed(3)} | ${s.ball.num}->${s.pocket.id}` +
      ` cue (${s.cuePos.x.toFixed(1)},${s.cuePos.y.toFixed(1)}) cut ${s.cutDeg.toFixed(0)}` +
      ` ${s.type} t ${s.travel.toFixed(0)}" r${s.rails} e ${s.eNext?.toFixed(3)}` +
      ` land (${s.landing!.x.toFixed(1)},${s.landing!.y.toFixed(1)})`,
    );
  }
  if (k === 1) {
    // where are the TS rail-fold children?
    const folds = nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => {
        const s = n.done[0];
        return s.pocket.id === 'TS' && s.rails >= 1 && s.cutDeg < 25 && s.type === 'follow';
      });
    console.log(`-- TS one-rail follow children: ${folds.length}`);
    for (const { n, i } of folds.slice(0, 6)) {
      const s = n.done[0];
      console.log(
        `   rank ${i} score ${n.score.toFixed(3)} cut ${s.cutDeg.toFixed(0)} t ${s.travel.toFixed(0)}" r${s.rails}` +
        ` e ${s.eNext?.toFixed(3)} land (${s.landing!.x.toFixed(1)},${s.landing!.y.toFixed(1)})`,
      );
    }
  }
}

// --- continue the beam from the fold child alone: what is its FINAL score?
{
  const surfaces2 = surfacesForLayout(layout, INTERMEDIATE);
  const targetsB = zoneTargets(
    layout.balls[1], layout.balls.slice(2), INTERMEDIATE, gateFor(surfaces2, 2),
  );
  let ns = initialNodes(layout, INTERMEDIATE, gateFor(surfaces2, 1), targetsB);
  ns = expandNodes(ns, layout.balls[1], layout.balls.slice(2), INTERMEDIATE, gateFor(surfaces2, 2));
  let fold = ns.filter((n) => {
    const s = n.done[0];
    return s.pocket.id === 'TS' && s.rails >= 1 && s.cutDeg < 25 && s.type === 'follow';
  });
  console.log(`\n=== fold-only continuation (${fold.length} fold nodes) ===`);
  for (let k = 2; k < layout.balls.length && fold.length > 0; k++) {
    fold = expandNodes(fold, layout.balls[k], layout.balls.slice(k + 1), INTERMEDIATE, gateFor(surfaces2, k + 1));
  }
  for (const n of fold.slice(0, 3)) {
    console.log(`final fold score ${n.score.toFixed(3)}`);
    for (const s of n.done) {
      console.log(
        `  ${s.ball.num}->${s.pocket.id} cut ${s.cutDeg.toFixed(0)} ${s.type} t ${s.travel.toFixed(0)} r${s.rails}` +
        ` e ${s.eNext?.toFixed(3)} land (${s.landing!.x.toFixed(1)},${s.landing!.y.toFixed(1)})`,
      );
    }
    console.log(`  pending ${n.pending.ball.num}->${n.pending.pocket.id} pot ${n.pending.potProb.toFixed(3)}`);
  }
}
