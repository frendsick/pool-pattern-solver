// Mid-range pot calibration table: straight corner pots at increasing
// ball-to-pocket distance, cue parked 12" behind (the ball-in-hand placement
// that made mid-range pots read too confident), across throwSigma candidates.
import { INTERMEDIATE, potProbability } from '../src/skill';
import { pocketById } from '../src/table';
import { shotGeometry } from '../src/shots';

const TR = pocketById('TR');
const TS = pocketById('TS');

const straight = (pocket: typeof TR, dist: number, cueBack: number) => {
  // ball on the diagonal into the pocket facing (dev 0), cue dead behind
  const f = pocket.facing;
  const ball = { x: pocket.target.x - f.x * dist, y: pocket.target.y - f.y * dist };
  const cue = { x: ball.x - f.x * cueBack, y: ball.y - f.y * cueBack };
  return shotGeometry(cue, ball, pocket)!;
};

const sigmas = [0.012, 0.016, 0.018, 0.02, 0.022, 0.025];
console.log('straight corner pot, cue 12" behind, dev 0:');
console.log('dist\\sigma | ' + sigmas.map((s) => s.toFixed(3)).join('  '));
for (const d of [15, 25, 35, 45, 60, 80]) {
  const g = straight(TR, d, 12);
  const row = sigmas.map((ts) =>
    potProbability(g, TR, { ...INTERMEDIATE, throwSigma: ts }).toFixed(3),
  );
  console.log(`${String(d).padStart(4)}"     | ` + row.join('  '));
}
console.log('\nhanging side pot (12" out, dev 0), cue 15" behind:');
{
  const g = straight(TS, 12, 15);
  const row = sigmas.map((ts) =>
    potProbability(g, TS, { ...INTERMEDIATE, throwSigma: ts }).toFixed(3),
  );
  console.log('           | ' + row.join('  '));
}
console.log('\nthe actual chosen leave shape: 45" to corner, dev 31.7 deg, cue 12" behind, cut ~2 deg:');
{
  // reconstruct: ball 45" from TR at 31.7 deg off facing, cue 12" behind on the pot line
  const dev = (31.7 * Math.PI) / 180;
  const f = TR.facing;
  const c = Math.cos(dev), s = Math.sin(dev);
  const dir = { x: f.x * c - f.y * s, y: f.x * s + f.y * c };
  const ball = { x: TR.target.x - dir.x * 45, y: TR.target.y - dir.y * 45 };
  const cue = { x: ball.x - dir.x * 12, y: ball.y - dir.y * 12 };
  const g = shotGeometry(cue, ball, TR)!;
  const row = sigmas.map((ts) =>
    potProbability(g, TR, { ...INTERMEDIATE, throwSigma: ts }).toFixed(3),
  );
  console.log('           | ' + row.join('  '));
}
