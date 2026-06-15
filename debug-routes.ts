import { generatePuzzle } from './src/generator';
import { INTERMEDIATE } from './src/skill';
import { dist } from './src/geometry';
import { shotGeometry, caromCurve } from './src/shots';
import { surfacesForLayout } from './src/value';
import { zoneTargets, routeCandidates, expectedNextPot } from './src/route';

const seed = 149894255;
const puzzle = generatePuzzle(seed, 9, INTERMEDIATE)!;
const layout = puzzle.layout;
const skill = INTERMEDIATE;
const surfaces = surfacesForLayout(layout, skill);

// Shot 4: cue lands at shot-3 landing. Use the solved pattern's shot-4 cue pos.
const shot4 = puzzle.pattern.shots[3];
const ball4 = layout.balls[3]; // num 4
const ball5 = layout.balls[4]; // num 5
const later = layout.balls.slice(5);
const cue = shot4.cuePos;
console.log('Shot 4 cue pos:', cue, 'ball4', ball4.pos, 'ball5', ball5.pos);

const g = shotGeometry(cue, ball4.pos, shot4.pocket)!;
console.log('cut(deg)=', (g.cut * 180 / Math.PI).toFixed(2), 'dCueGhost=', g.dCueGhost.toFixed(1));

const targets = zoneTargets(layout.balls, 4, surfaces, skill);
console.log('zone targets pockets:', targets.map((t) => t.pocket.id).join(','));

const obstacles = [ball5.pos, ...later.map((b) => b.pos)];
const laterPos = later.map((b) => b.pos);

for (const lenient of [false, true]) {
  const cands = routeCandidates(g, obstacles, targets, skill, lenient);
  if (cands.length === 0 && !lenient) { console.log('(strict pass empty)'); continue; }
  console.log(`\n=== ${lenient ? 'LENIENT' : 'STRICT'} pass: ${cands.length} candidates ===`);
  // Compute full e like expandPass does.
  const rows = cands.map((c) => {
    const curve = caromCurve(g, c.type, c.travel) ?? undefined;
    const eRaw = expectedNextPot(
      g.ghost, c.dir, c.travel, c.type, c.rails, obstacles, c.zc, skill, g.dCueGhost,
      { g, pocket: shot4.pocket }, curve, false,
    );
    const e = eRaw * c.ease * c.windowFactor;
    return { c, eRaw, e, dist5: dist(c.landing, ball5.pos) };
  });
  rows.sort((a, b) => b.e - a.e);
  for (const r of rows.slice(0, 14)) {
    const c = r.c;
    console.log(
      `  ${c.type.padEnd(8)} pk=${c.nextPocket.id} travel=${c.travel.toFixed(0).padStart(4)} rails=${c.rails} ` +
      `land=(${c.landing.x.toFixed(0)},${c.landing.y.toFixed(0)}) d5=${r.dist5.toFixed(0).padStart(3)} ` +
      `merit=${c.merit.toFixed(3)} ease=${c.ease.toFixed(3)} wf=${c.windowFactor.toFixed(2)} ` +
      `eRaw=${(r.eRaw * 100).toFixed(0)}% e=${(r.e * 100).toFixed(0)}%`,
    );
  }
  if (!lenient) break;
}
