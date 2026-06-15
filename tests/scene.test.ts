// The renderer draws the SAME Position Zone the route was scored against.
// Candidate B of the architecture review: the gated zone for a shot used to be
// rebuilt independently by the route search and by scene.ts, and the planned
// landing could fall in the dead gap between the drawn lobes. Now finalize
// stamps the resolved zone on the shot (solver.ts resolveShotZones) and
// scene.ts draws THAT, so the window the user sees is the window the route was
// scored against by construction.

import { describe, it, expect } from 'vitest';
import { vec } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';
import { originWindowForStep, sceneForStep } from '../src/scene';
import { zoneBar, zoneValue } from '../src/zone';

// The "open three-ball layout" golden — solves confidently, every shot routed.
const layout: Layout = {
  seed: 0,
  balls: [
    { num: 7, pos: vec(25, 35) },
    { num: 8, pos: vec(50, 15) },
    { num: 9, pos: vec(75, 35) },
  ],
};

describe('scene draws the Position Zone the route was scored against', () => {
  const pattern = solve(layout, INTERMEDIATE);
  if (!pattern) throw new Error('fixture failed to solve');
  const shots = pattern.shots;

  it('builds a scene for every step without throwing, wiring the overview', () => {
    // Steps: 0 = bare layout, 1 = overview, 2..n+1 = shots 1..n.
    for (let s = 0; s <= shots.length + 1; s++) {
      expect(sceneForStep(layout, pattern, s, INTERMEDIATE)).toBeTruthy();
    }
    const overview = sceneForStep(layout, pattern, 1, INTERMEDIATE);
    expect(overview.cue).not.toBeNull();
    expect(overview.ghostPaths.length).toBeGreaterThan(0);
  });

  it('only exposes the origin Position Window while cue-ball drag is highlighted', () => {
    const firstShot = sceneForStep(layout, pattern, 2, INTERMEDIATE);
    expect(firstShot.originZone).toEqual([]);
    expect(firstShot.cueDraggable).toBe(true);
    expect(firstShot.originZoneHighlighted).toBe(false);

    const firstDrag = sceneForStep(layout, pattern, 2, INTERMEDIATE, {
      highlightOriginZone: true,
    });
    expect(firstDrag.originZoneHighlighted).toBe(true);
    expect(firstDrag.originZone).toEqual(originWindowForStep(pattern, 2, INTERMEDIATE));
    expect(firstDrag.originZone).toHaveLength(1);
    expect(firstDrag.originZone[0]).toHaveLength(4);

    const secondShot = sceneForStep(layout, pattern, 3, INTERMEDIATE);
    expect(secondShot.originZone).toEqual([]);
    const secondDrag = sceneForStep(layout, pattern, 3, INTERMEDIATE, {
      highlightOriginZone: true,
    });
    expect(secondDrag.originZone.length).toBeGreaterThan(0);
    expect(secondDrag.originZone).toEqual(originWindowForStep(pattern, 3, INTERMEDIATE));
  });

  it('the planned landing clears the bar of the drawn primary window', () => {
    // Every routed (non-final) shot is shown at step i+2; the drawn window is
    // built from the stamped shot.zone with cap = windowRef. The route's own
    // landing must clear that window's bar — i.e. it sits inside the window the
    // renderer draws, not in a dead gap beside it.
    for (let i = 0; i < shots.length - 1; i++) {
      const shot = shots[i];
      expect(shot.zone).not.toBeNull();
      expect(shot.landing).not.toBeNull();

      const scene = sceneForStep(layout, pattern, i + 2, INTERMEDIATE);
      expect(scene.zone.length).toBeGreaterThan(0); // a window is drawn

      const bar = zoneBar(shot.zone!, INTERMEDIATE, 0, shot.windowRef ?? Infinity);
      expect(
        zoneValue(shot.landing!, shot.zone!, INTERMEDIATE),
      ).toBeGreaterThanOrEqual(bar - 1e-9);
    }
  });
});
