// Jitter the round-6 feedback layout (repro-straight-power.ts) and check
// that no chosen route demands more hit power than a player can stroke:
// hitDistance must stay below SkillProfile.hitMax for every planned shot.

import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';
import { shotGeometry, hitDistance } from '../src/shots';

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = [vec(80.5, 31.6), vec(86.8, 5.5), vec(74.8, 12.9)];

let shots = 0;
let over = 0;
let worst = 0;
for (let k = 0; k < 40; k++) {
  const rnd = mulberry32(2000 + k);
  const j = () => (rnd() - 0.5) * 5; // +-2.5"
  const balls = base.map((p, i) => ({ num: 7 + i, pos: vec(p.x + j(), p.y + j()) }));
  const layout: Layout = { seed: k, balls };
  const pat = solve(layout, INTERMEDIATE);
  if (!pat) {
    console.log(`v${k}: NONE`);
    continue;
  }
  for (const s of pat.shots) {
    if (!s.type || s.type === 'stop') continue;
    const g = shotGeometry(s.cuePos, s.ball.pos, s.pocket);
    if (!g) continue;
    shots++;
    const hit = hitDistance(g, s.type, s.travel);
    worst = Math.max(worst, hit);
    if (hit > INTERMEDIATE.hitMax) {
      over++;
      console.log(
        `v${k}: ${s.ball.num}>${s.pocket.id}/${s.type} cut ${s.cutDeg.toFixed(0)}° ` +
          `travel ${s.travel.toFixed(0)}″ -> hit ${hit.toFixed(0)}″ OVER MAX`,
      );
    }
  }
}
console.log(`routes checked: ${shots}`);
console.log(`over hitMax (${INTERMEDIATE.hitMax}″): ${over}`);
console.log(`worst hit demanded: ${worst.toFixed(0)}″`);
