// Image #30: step the beam by hand and watch where the 5->TR follow node goes.

import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { initialNodes, expandNodes, Node } from '../src/solver';
import { surfacesForLayout, gateFor } from '../src/value';

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
const surfaces = surfacesForLayout(layout, INTERMEDIATE);

let nodes = initialNodes(layout, INTERMEDIATE, gateFor(surfaces, 1));
const byPocket = new Map<string, number>();
for (const n of nodes) {
  byPocket.set(n.pending.pocket.id, (byPocket.get(n.pending.pocket.id) ?? 0) + 1);
}
console.log('initial nodes per pocket:', [...byPocket.entries()].map(([k, v]) => `${k}:${v}`).join(' '));
const trSeeds = nodes.filter((n) => n.pending.pocket.id === 'TR');
for (const n of trSeeds.slice(0, 12)) {
  console.log(
    `  TR seed cue (${n.pending.cuePos.x.toFixed(1)},${n.pending.cuePos.y.toFixed(1)})` +
      ` cut ${((n.pending.g.cut * 180) / Math.PI).toFixed(0)} pot ${n.pending.potProb.toFixed(3)}`,
  );
}

function describe(n: Node): string {
  const s = n.done[n.done.length - 1];
  return (
    `score ${n.score.toFixed(3)} sortKey ${n.sortKey.toFixed(3)} | ` +
    `${s.ball.num}->${s.pocket.id} cue (${s.cuePos.x.toFixed(1)},${s.cuePos.y.toFixed(1)})` +
    ` cut ${s.cutDeg.toFixed(0)} ${s.type} t ${s.travel.toFixed(0)}" r ${s.rails}` +
    ` eNext ${s.eNext?.toFixed(3)} land (${s.landing!.x.toFixed(1)},${s.landing!.y.toFixed(1)})`
  );
}

for (let k = 1; k < layout.balls.length; k++) {
  nodes = expandNodes(nodes, layout.balls[k], layout.balls.slice(k + 1), INTERMEDIATE, gateFor(surfaces, k + 1));
  console.log(`\n=== after expanding to ball ${layout.balls[k].num}: ${nodes.length} nodes ===`);
  for (const n of nodes.slice(0, 12)) console.log('  ' + describe(n));
  const tr = nodes.filter((n) => n.done[0].pocket.id === 'TR');
  console.log(`  (shot-1 TR survivors: ${tr.length})`);
  if (tr.length > 0 && tr[0] !== nodes[0]) console.log('  best TR: ' + describe(tr[0]));
}
