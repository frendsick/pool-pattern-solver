// Timing probe for the backward value-surface pass: solve time (surfaces
// included, cold cache per layout) across ball counts.
import { generatePuzzle } from '../src/generator';
import { solve } from '../src/solver';
import { INTERMEDIATE } from '../src/skill';
import { buildSurfaces } from '../src/value';
import { Layout } from '../src/table';

for (const n of [3, 5, 7, 9]) {
  const layouts: Layout[] = [];
  for (let seed = 1; layouts.length < 8 && seed < 400; seed++) {
    const puz = generatePuzzle(seed, n, INTERMEDIATE);
    if (puz) layouts.push(puz.layout);
  }
  const tSurf: number[] = [];
  const tSolve: number[] = [];
  for (const l of layouts) {
    const t0 = performance.now();
    buildSurfaces(l.balls, INTERMEDIATE);
    const t1 = performance.now();
    solve({ ...l }, INTERMEDIATE); // fresh object: cold surface cache inside solve
    tSurf.push(t1 - t0);
    tSolve.push(performance.now() - t1);
  }
  const med = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log(
    `${n} balls: surfaces ${med(tSurf).toFixed(0)}ms  solve(total, cold) ${med(tSolve).toFixed(0)}ms  (n=${layouts.length})`,
  );
}
