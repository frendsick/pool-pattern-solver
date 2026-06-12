// Diagnose the two golden-test shifts after the backward value-surface pass.
import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';

const layout: Layout = {
  seed: 0,
  balls: [
    { num: 7, pos: vec(43.4, 5.4) },
    { num: 8, pos: vec(18.8, 9.9) },
    { num: 9, pos: vec(45.5, 13.8) },
  ],
};
const pattern = solve(layout, INTERMEDIATE)!;
for (const s of pattern.shots) {
  console.log(
    `${s.ball.num} -> ${s.pocket.id}  cut ${s.cutDeg.toFixed(0)}  pot ${s.potProb.toFixed(3)}` +
    `  type ${s.type}  eNext ${s.eNext?.toFixed(3) ?? '-'}  cue (${s.cuePos.x.toFixed(1)},${s.cuePos.y.toFixed(1)})`,
  );
}
console.log('score', pattern.score.toFixed(3));
