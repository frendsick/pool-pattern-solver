import { describe, it, expect } from 'vitest';
import { add, dist, scale, vec, Vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve, solveFromCue } from '../src/solver';
import { originWindowForStep } from '../src/scene';
import { clampCuePosition, pointInPolygons } from '../src/interaction';

function centroid(poly: Vec[]): Vec {
  return scale(
    poly.reduce((sum, p) => add(sum, p), vec(0, 0)),
    1 / poly.length,
  );
}

function unique(points: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of points) {
    if (!out.some((q) => dist(p, q) < 0.5)) out.push(p);
  }
  return out;
}

function windowSamples(polys: Vec[][], cue: Vec): Vec[] {
  const samples = [cue];
  for (const poly of polys) {
    if (poly.length < 3) continue;
    const c = centroid(poly);
    if (pointInPolygons(c, polys)) samples.push(c);
    for (const v of poly) {
      const p = add(scale(c, 0.65), scale(v, 0.35));
      if (pointInPolygons(p, polys)) samples.push(p);
    }
  }
  return unique(samples);
}

const fixedLayouts: { name: string; layout: Layout }[] = [
  {
    name: 'open three-ball',
    layout: {
      seed: 0,
      balls: [
        { num: 7, pos: vec(25, 35) },
        { num: 8, pos: vec(50, 15) },
        { num: 9, pos: vec(75, 35) },
      ],
    },
  },
  {
    name: 'side-pocket hanger',
    layout: {
      seed: 0,
      balls: [
        { num: 7, pos: vec(43.4, 5.4) },
        { num: 8, pos: vec(18.8, 9.9) },
        { num: 9, pos: vec(45.5, 13.8) },
      ],
    },
  },
];

describe('Position Window tightness probe', () => {
  it('keeps fixed-layout Alternative Leaves feasible and approximately flat', () => {
    const maxRelativeSwing = 0.6;

    for (const { name, layout } of fixedLayouts) {
      const pattern = solve(layout, INTERMEDIATE);
      expect(pattern, name).not.toBeNull();
      for (let shotIndex = 1; shotIndex < pattern!.shots.length; shotIndex++) {
        const origin = originWindowForStep(pattern!, shotIndex + 2, INTERMEDIATE);
        if (origin.length === 0) continue;
        const baseSuffix = solveFromCue(
          layout,
          INTERMEDIATE,
          shotIndex,
          pattern!.shots[shotIndex].cuePos,
        );
        expect(baseSuffix, `${name} shot ${shotIndex + 1} base suffix`).not.toBeNull();
        const prefix = pattern!.score / baseSuffix!.score;
        const samples = windowSamples(origin, pattern!.shots[shotIndex].cuePos);
        const scores: { cue: Vec; score: number }[] = [];

        for (const raw of samples) {
          const cue = clampCuePosition(raw, origin, layout.balls.slice(shotIndex));
          expect(pointInPolygons(cue, origin), `${name} shot ${shotIndex + 1} sample`).toBe(true);
          const suffix = solveFromCue(layout, INTERMEDIATE, shotIndex, cue);
          expect(suffix, `${name} shot ${shotIndex + 1} cue ${cue.x},${cue.y}`).not.toBeNull();
          scores.push({ cue, score: prefix * suffix!.score });
        }

        const values = scores.map((s) => s.score);
        const max = Math.max(...values);
        const min = Math.min(...values);
        const detail = scores
          .map((s) => `(${s.cue.x.toFixed(1)},${s.cue.y.toFixed(1)})=${s.score.toFixed(3)}`)
          .join(' ');
        expect(
          (max - min) / Math.max(max, 1e-9),
          `${name} shot ${shotIndex + 1}: ${detail}`,
        ).toBeLessThanOrEqual(maxRelativeSwing);
      }
    }
  });
});
