import { vec, add, scale, norm, sub, rotate } from '../src/geometry';
import { pocketById } from '../src/table';
import { shotGeometry } from '../src/shots';
import { potProbability, INTERMEDIATE } from '../src/skill';

// Straight-ish shots at growing distances into a corner vs side.
const cases = [
  { name: 'short side (15" ball-pocket, 15" cue, 10°)', pid: 'BS', dbp: 15, dcg: 15, cutDeg: 10 },
  { name: 'mid side   (25", 25", 20°)', pid: 'BS', dbp: 25, dcg: 25, cutDeg: 20 },
  { name: 'short corner (20", 20", 10°)', pid: 'BR', dbp: 20, dcg: 20, cutDeg: 10 },
  { name: 'mid corner (35", 30", 25°)', pid: 'BR', dbp: 35, dcg: 30, cutDeg: 25 },
  { name: 'long corner (60", 40", 25°)', pid: 'BR', dbp: 60, dcg: 40, cutDeg: 25 },
  { name: 'long corner (70", 50", 35°)', pid: 'BR', dbp: 70, dcg: 50, cutDeg: 35 },
  { name: 'table-length corner (85", 60", 15°)', pid: 'BR', dbp: 85, dcg: 60, cutDeg: 15 },
];

for (const sigma of [0.003, 0.0045, 0.006, 0.008]) {
  const skill = { ...INTERMEDIATE, aimSigma: sigma };
  console.log(`\naimSigma=${sigma} (${(sigma * 180 / Math.PI).toFixed(2)}°):`);
  for (const c of cases) {
    const pocket = pocketById(c.pid as any);
    // place ball dbp from pocket along facing-back direction
    const back = scale(pocket.facing, -1);
    const ball = add(pocket.target, scale(back, c.dbp));
    const aim = norm(sub(pocket.target, ball));
    const ghost = sub(ball, scale(aim, 2 * 1.125));
    // cue at dcg from ghost, rotated cutDeg off the aim-back line
    const cue = add(ghost, scale(rotate(scale(aim, -1), (c.cutDeg * Math.PI) / 180), c.dcg));
    const g = shotGeometry(cue, ball, pocket)!;
    console.log(`  ${c.name}: pot=${(potProbability(g, pocket, skill) * 100).toFixed(1)}% (cut ${(g.cut * 180 / Math.PI).toFixed(0)}°)`);
  }
}
