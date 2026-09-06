import { describe, it, expect } from 'vitest';
import { vec, norm, scale, sub, Vec } from '../src/geometry';
import { Layout, pocketById, effectiveAcceptance, POCKETS } from '../src/table';
import { INTERMEDIATE, potProbability } from '../src/skill';
import { shotGeometry } from '../src/shots';
import { zoneContext, zoneBar, zonePolygons } from '../src/zone';
import { solve } from '../src/solver';
import { generatePuzzle } from '../src/generator';

// Image #29 (2026-06-12, round 17): the 7 hangs ~8.5" from the bottom side
// pocket, arriving ~51 deg off the facing. With JAW_RANGE 6 that read as
// unpottable (effective acceptance ~47 deg at 8.5"), so the solver sent the
// 7 forty-four inches cross-table to the bottom-left corner. "Why don't we
// make the easy stop shot?" — the near-mouth cone now decays over 9", and
// the side pot is available. Corrected corner targets also offer a shorter
// opening route whose complete Pattern now scores higher.
describe('side-pocket hanger at a steep approach (image #29, round 17)', () => {
  const layout: Layout = {
    seed: 0,
    balls: [
      { num: 7, pos: vec(43.4, 5.4) },
      { num: 8, pos: vec(18.8, 9.9) },
      { num: 9, pos: vec(45.5, 13.8) },
    ],
  };
  const bs = pocketById('BS');

  it('the cone admits ~51 deg at 8.5" but still rejects it at 30"', () => {
    expect(effectiveAcceptance(bs, 8.5)).toBeGreaterThan((50.7 * Math.PI) / 180);
    expect(effectiveAcceptance(bs, 30)).toBeLessThan((45.5 * Math.PI) / 180);
  });

  it('the hanging 7 is a near-certain pot from a straight placement', () => {
    const aim = norm(sub(bs.target, layout.balls[0].pos));
    const ghost = sub(layout.balls[0].pos, scale(aim, 2.25));
    const cue = sub(ghost, scale(aim, 12));
    const g = shotGeometry(cue, layout.balls[0].pos, bs)!;
    expect(potProbability(g, bs, INTERMEDIATE)).toBeGreaterThan(0.95);
  });

  it('keeps a strong run-out through the nearby side pocket', () => {
    const pattern = solve(layout, INTERMEDIATE)!;
    expect(pattern).not.toBeNull();
    expect(pattern.shots[0].pocket.id).toBe('BS');
    expect(pattern.shots[0].potProb).toBeGreaterThan(0.9);
    // The corrected energy model reaches position with a short side opening.
    expect(pattern.shots[0].travel).toBeLessThan(30);
    expect(pattern.score).toBeGreaterThan(0.72);
  });
});

// Fallout guard: seed 63's shot-1 window has a rich stretch pinched mid-ray
// by the 9's clearance ring. An earlier builder stopped the whole ray at the
// first below-bar dip past a good run, clipping the big outer region the route
// search had just landed in. buildWindows bridges below-bar (still-playable)
// stripes and breaks only at dead cells, so the window stays continuous
// through the dip and keeps the landing.
describe('mid-ray pinch keeps the landing in the window (seed 63, round 17)', () => {
  function inPoly(p: Vec, poly: Vec[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  it('the planned landing stays inside the drawn window', () => {
    const { layout, pattern } = generatePuzzle(63, 3, INTERMEDIATE)!;
    const shot = pattern.shots[0];
    const next = pattern.shots[1];
    expect(shot.landing).not.toBeNull();
    const after = layout.balls[2];
    const nextZones = POCKETS.map((p) => zoneContext(after.pos, p, [])).filter(
      (z) => z.ballPathClear,
    );
    const zc = zoneContext(next.ball.pos, next.pocket, [], nextZones);
    const cap = shot.windowRef ?? Infinity;
    const polys = zonePolygons(zc, INTERMEDIATE, 0, 85, cap);
    expect(polys.some((poly) => inPoly(shot.landing!, poly))).toBe(true);
    // the value itself clears the displayed bar (sanity that this is the
    // polygon's job, not the bar's)
    const bar = zoneBar(zc, INTERMEDIATE, 0, cap);
    expect(bar).toBeGreaterThan(0);
  });
});
