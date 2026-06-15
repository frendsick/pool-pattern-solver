import { generatePuzzle } from './src/generator';
import { INTERMEDIATE } from './src/skill';
import { dist } from './src/geometry';

const seed = 149894255;
const n = 9;
const puzzle = generatePuzzle(seed, n, INTERMEDIATE);
if (!puzzle) {
  console.log('no puzzle');
  process.exit(1);
}
console.log('Run-out:', (puzzle.pattern.score * 100).toFixed(1) + '%');
console.log('Balls:');
for (const b of puzzle.layout.balls) {
  console.log(`  ${b.num}: (${b.pos.x.toFixed(1)}, ${b.pos.y.toFixed(1)})`);
}
console.log('\nShots:');
const shots = puzzle.pattern.shots;
for (let i = 0; i < shots.length; i++) {
  const s = shots[i];
  const next = shots[i + 1];
  const landStr = s.landing ? `(${s.landing.x.toFixed(1)}, ${s.landing.y.toFixed(1)})` : '—';
  const distNext = next && s.landing ? dist(s.landing, next.ball.pos).toFixed(1) : '—';
  console.log(
    `  Shot ${i + 1}: ball ${s.ball.num} -> ${s.pocket.id}  cut=${s.cutDeg.toFixed(1)}°  pot=${(s.potProb * 100).toFixed(0)}%  ` +
      `type=${s.type ?? '—'}  travel=${s.travel.toFixed(1)}  rails=${s.rails}  ` +
      `land=${landStr}  distToNext=${distNext}  eNext=${s.eNext !== null ? (s.eNext * 100).toFixed(0) + '%' : '—'}  ` +
      `zoneLen=${s.zoneLen?.toFixed(1) ?? '—'}  entryDeg=${s.entryDeg?.toFixed(0) ?? '—'}`,
  );
  console.log(`       cuePos=(${s.cuePos.x.toFixed(1)}, ${s.cuePos.y.toFixed(1)})  ${s.explanation}`);
}
