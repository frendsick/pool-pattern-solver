// Repro for "position window visualization is off with the cueball location"
// (2026-06-11 screenshot): layout reconstructed from the image; checks whether
// shot 1's planned landing lies inside the zone the user SEES (onward-control
// zone from scene.ts) vs the pot-only zone the route search ran on.

import { writeFileSync, mkdirSync } from 'node:fs';
import { Layout, POCKETS } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';
import { sceneForStep } from '../src/scene';
import { renderScene } from '../src/render';
import { zoneContext, zoneBar, zoneValue, zonePeak } from '../src/zone';

const layout: Layout = {
  balls: [
    { num: 7, pos: { x: 80.8, y: 32.1 } },
    { num: 8, pos: { x: 87.5, y: 4.9 } },
    { num: 9, pos: { x: 75.2, y: 12.7 } },
  ],
  seed: 0,
};

const pattern = solve(layout, INTERMEDIATE)!;
for (let i = 0; i < pattern.shots.length; i++) {
  const s = pattern.shots[i];
  console.log(
    `shot ${i + 1}: ${s.ball.num} -> ${s.pocket.id}, cue (${s.cuePos.x.toFixed(1)}, ${s.cuePos.y.toFixed(1)}),` +
      ` type ${s.type}, landing ${s.landing ? `(${s.landing.x.toFixed(1)}, ${s.landing.y.toFixed(1)})` : '-'}`,
  );
}

const shot1 = pattern.shots[0];
const next = pattern.shots[1];
const landing = shot1.landing!;

// Displayed zone (scene.ts logic): onward control toward the ball after next.
const later = layout.balls.slice(2).map((b) => b.pos);
const after = layout.balls[2];
const nextZones = POCKETS.map((p) => zoneContext(after.pos, p, [])).filter(
  (z) => z.ballPathClear,
);
const displayed = zoneContext(next.ball.pos, next.pocket, later, nextZones);
const displayedBar = zoneBar(displayed, INTERMEDIATE);
const vDisplayed = zoneValue(landing, displayed, INTERMEDIATE);

// Pot-only zone (solver route-search logic).
const potOnly = zoneContext(next.ball.pos, next.pocket, later);
const potBar = Math.max(0.12, 0.8 * zonePeak(potOnly, INTERMEDIATE));
const vPotOnly = zoneValue(landing, potOnly, INTERMEDIATE);

console.log(`\nlanding (${landing.x.toFixed(1)}, ${landing.y.toFixed(1)}) for ${next.ball.num} -> ${next.pocket.id}`);
console.log(`displayed zone: value ${vDisplayed.toFixed(3)} vs bar ${displayedBar.toFixed(3)} -> ${vDisplayed >= displayedBar ? 'INSIDE' : 'OUTSIDE'}`);
console.log(`pot-only zone:  value ${vPotOnly.toFixed(3)} vs bar ${potBar.toFixed(3)} -> ${vPotOnly >= potBar ? 'INSIDE' : 'OUTSIDE'}`);

mkdirSync('/tmp/pps-snapshots', { recursive: true });
for (let s = 0; s <= pattern.shots.length + 1; s++) {
  writeFileSync(
    `/tmp/pps-snapshots/repro-step${s}.svg`,
    renderScene(sceneForStep(layout, pattern, s, INTERMEDIATE)),
  );
}
console.log('\nsnapshots in /tmp/pps-snapshots/repro-step*.svg');
