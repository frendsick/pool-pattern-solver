// For sweep variants that still choose a corner: is the side pocket actually
// infeasible (approach past acceptance), or merely under-prioritized?

import { vec, sub, norm, angleBetween } from '../src/geometry';
import { pocketById } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { zoneContext, zonePeak } from '../src/zone';

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = [vec(57.5, 38.3), vec(35.9, 43.3), vec(55.1, 7.5)];
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);

for (const k of [0, 4, 8, 9, 16, 18, 32]) {
  const rnd = mulberry32(1000 + k);
  const j = () => (rnd() - 0.5) * 5;
  const balls = base.map((p, i) => ({ num: 7 + i, pos: vec(p.x + j(), p.y + j()) }));
  const seven = balls[0];
  const nine = balls[2];
  const lines: string[] = [];
  for (const [ball, pid] of [
    [seven, 'TS'],
    [nine, 'BS'],
  ] as const) {
    const p = pocketById(pid);
    const aim = norm(sub(p.target, ball.pos));
    const dev = angleBetween(aim, p.facing);
    const others = balls.filter((b) => b !== ball && b.num > ball.num).map((b) => b.pos);
    const peak = zonePeak(zoneContext(ball.pos, p, others), INTERMEDIATE);
    lines.push(
      `${ball.num}->${pid}: dev=${deg(dev)}° (acc ${deg(p.acceptance)}°) peak=${peak.toFixed(2)}`,
    );
  }
  console.log(`v${k}: ${lines.join('  |  ')}`);
}
