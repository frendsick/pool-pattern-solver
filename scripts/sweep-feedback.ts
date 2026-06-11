// Jitter the Image #14 layout and print each variant's chosen pockets, to
// diff solver behavior before/after the cross-pocket quality bar.

import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = [vec(57.5, 38.3), vec(35.9, 43.3), vec(55.1, 7.5)];

for (let k = 0; k < 40; k++) {
  const rnd = mulberry32(1000 + k);
  const j = () => (rnd() - 0.5) * 5; // +-2.5"
  const balls = base.map((p, i) => ({ num: 7 + i, pos: vec(p.x + j(), p.y + j()) }));
  const layout: Layout = { seed: k, balls };
  const pat = solve(layout, INTERMEDIATE);
  const desc = pat
    ? pat.shots
        .map((s) => `${s.ball.num}>${s.pocket.id}${s.type ? '/' + s.type : ''}`)
        .join(' ') + ` ${(pat.score * 100).toFixed(0)}%`
    : 'NONE';
  console.log(`v${k}: ${desc}`);
}
