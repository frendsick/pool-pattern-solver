import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { POCKETS, BALL_R } from '../src/table';
import { zoneContext, zonePeak, zoneValue } from '../src/zone';
import { shotGeometry, approachDeviation, ballPathToPocketClear } from '../src/shots';
import { potProbability } from '../src/skill';

const puzzle = generatePuzzle(671833607, 3, INTERMEDIATE)!;
const balls = puzzle.layout.balls;
for (const b of balls) console.log(`ball ${b.num}: (${b.pos.x.toFixed(1)}, ${b.pos.y.toFixed(1)})`);

// for each ball, each pocket: distance to pocket, approach deviation vs acceptance, zone peak
for (const b of balls) {
  const others = balls.filter(o => o.num !== b.num && o.num > b.num).map(o => o.pos);
  console.log(`\n=== ball ${b.num} (later obstacles: ${others.length}) ===`);
  for (const p of POCKETS) {
    const aim = { x: p.target.x - b.pos.x, y: p.target.y - b.pos.y };
    const d = Math.hypot(aim.x, aim.y);
    const dev = approachDeviation({ x: aim.x / d, y: aim.y / d }, p) * 180 / Math.PI;
    const clear = ballPathToPocketClear(b.pos, p, others);
    const zc = zoneContext(b.pos, p, others);
    const peak = zonePeak(zc, INTERMEDIATE);
    console.log(`${p.id}: dist ${d.toFixed(1)}", dev ${dev.toFixed(1)} deg (acc ${(p.acceptance*180/Math.PI).toFixed(0)}), clear ${clear}, zonePeak ${peak.toFixed(3)}`);
  }
}
