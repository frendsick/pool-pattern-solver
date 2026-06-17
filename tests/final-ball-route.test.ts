// The final ball (the 9) gets a Route too — but no next Position Window to
// reach, so it is chosen for SAFETY (issue #18, ADR-0006, CONTEXT.md: Route /
// Run-out Probability). The pocket x shot type maximizing P(pot) x P(no
// scratch) at minimal natural travel, tie-broken toward the easiest type, with
// scratch priced through the same pocketRisk machinery as mid-rack scratch and
// folded into the reported run-out probability.

import { describe, it, expect } from 'vitest';
import { vec } from '../src/geometry';
import { Layout, POCKETS } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { zoneContext, zoneValue } from '../src/zone';
import { finalSafetyRoute } from '../src/route';
import { sceneForStep } from '../src/scene';
import { solve, solveFromCue } from '../src/solver';

describe('final ball safety Route (issue #18)', () => {
  it('assigns the final ball a real Route that the diagram draws', () => {
    const layout: Layout = {
      seed: 0,
      balls: [
        { num: 7, pos: vec(25, 35) },
        { num: 8, pos: vec(50, 15) },
        { num: 9, pos: vec(75, 35) },
      ],
    };
    const pattern = solve(layout, INTERMEDIATE)!;
    expect(pattern).not.toBeNull();
    const nine = pattern.shots[2];
    // No null pot-only shot anymore: it carries a shot type, a traced cue path,
    // and a landing ghost — but never a next Position Window.
    expect(nine.type).not.toBeNull();
    expect(nine.path).not.toBeNull();
    expect(nine.path!.length).toBeGreaterThanOrEqual(2);
    expect(nine.landing).not.toBeNull();
    expect(nine.zone).toBeNull();

    // The renderer draws the cue path + landing like every other shot: the
    // final step's Scene exposes the route geometry without any animation.
    const scene = sceneForStep(layout, pattern, pattern.shots.length + 1, INTERMEDIATE);
    expect(scene.shot).not.toBeNull();
    expect(scene.shot!.path).not.toBeNull();
    expect(scene.shot!.landing).not.toBeNull();
  });

  it('plays a straight-in 9 as a safe stop and keeps the cue off a scratch', () => {
    // Cue dead behind the 9, straight into the top side pocket: the stop shot
    // (easiest type) leaves the cue put — no scratch — and wins the tie-break.
    const route = finalSafetyRoute(vec(50, 8), vec(50, 25), INTERMEDIATE)!;
    expect(route).not.toBeNull();
    expect(route.pocket.id).toBe('TS');
    expect(route.type).toBe('stop');
    expect(route.potProb).toBeGreaterThan(0.95);
    expect(route.noScratch).toBeCloseTo(1, 5);
  });

  it('prices a forced scratch through pocketRisk (no route avoids the pocket)', () => {
    // A 9 jammed by the bottom-left, cue crowding it: every pottable pocket x
    // type runs the cue into a pocket mouth. pocketRisk floors the route rather
    // than rejecting it (probabilistic, like mid-rack scratch).
    const route = finalSafetyRoute(vec(4, 25), vec(8, 20), INTERMEDIATE)!;
    expect(route).not.toBeNull();
    expect(route.noScratch).toBeLessThan(0.5);
  });

  it('folds the final-leg scratch risk into the reported run-out probability', () => {
    // Solve the single-ball leg from the forced-scratch cue placement so the
    // arrival position is fixed (the multi-ball solver would route around it).
    const layout: Layout = { seed: 0, balls: [{ num: 9, pos: vec(8, 20) }] };
    const pattern = solveFromCue(layout, INTERMEDIATE, 0, vec(4, 25))!;
    expect(pattern).not.toBeNull();
    expect(pattern.shots).toHaveLength(1);
    const nine = pattern.shots[0];
    const route = finalSafetyRoute(vec(4, 25), vec(8, 20), INTERMEDIATE)!;
    expect(nine.type).toBe(route.type);
    expect(nine.pocket.id).toBe(route.pocket.id);

    // The reported score is the pot-only leg value times P(no scratch): the
    // scratch penalty is in the run-out probability, not just the diagram.
    let bestPot = 0;
    for (const p of POCKETS) {
      const zc = zoneContext(vec(8, 20), p, []);
      if (!zc.ballPathClear) continue;
      bestPot = Math.max(bestPot, zoneValue(vec(4, 25), zc, INTERMEDIATE));
    }
    expect(pattern.score).toBeCloseTo(bestPot * route.noScratch, 5);
    // Collapsed well below the per-shot acceptance bar generation rejects on.
    expect(pattern.score).toBeLessThan(0.49);
  });
});
