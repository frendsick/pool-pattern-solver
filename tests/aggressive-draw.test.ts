// Aggression on easy short shots (2026-06-12 feedback, round 10): when the
// pot is easy and quite short, spend the headroom getting CLOSER to the next
// ball within the position window — maximum draw included — rather than
// settling for a comfortable touch near the window's entry. Not to the
// literal window edge: as close as possible while leaving margin for error
// (the landing-spread quadrature prices that margin). A half-table shot on
// the 9 is missable; half a meter closer it effectively is not.

import { describe, it, expect } from 'vitest';
import { vec, dist } from '../src/geometry';
import { pocketById, POCKETS, Layout } from '../src/table';
import { ShotType, shotGeometry } from '../src/shots';
import { INTERMEDIATE, routeReliability } from '../src/skill';
import { routeCandidates } from '../src/route';
import { expectedNextPot, solve } from '../src/solver';
import { zoneContext } from '../src/zone';

describe('a short draw is a reliable shot', () => {
  it('eases below ~1 m but draw stays the toughest type at any distance', () => {
    const at = (d: number) => routeReliability('draw', d, INTERMEDIATE);
    expect(at(20)).toBeGreaterThan(0.9); // half a meter: routine
    expect(at(20)).toBeLessThan(INTERMEDIATE.typeReliability.stun); // ordering kept
    expect(at(INTERMEDIATE.thinCutMaxDist)).toBeCloseTo(0.85, 5); // 1 m: unchanged
    expect(at(60)).toBeLessThan(0.85); // beyond: decays as before
    // monotone: shorter is never harder
    expect(at(10)).toBeGreaterThanOrEqual(at(20));
  });
});

describe('golden: easy short 8 ball, 9 far up-table (2026-06-12 round 10)', () => {
  const ball8 = vec(24, 15);
  const ball9 = vec(82, 36);
  const pocket = pocketById('BL');
  const cue = vec(39.7, 31.5); // ~16 deg cut, ~20" cue-to-ghost: easy + short

  /** Best route value with the same candidates and pricing as the solver. */
  function bestRoute(type: ShotType) {
    const g = shotGeometry(cue, ball8, pocket)!;
    const zones = POCKETS.map((p) => zoneContext(ball9, p, [])).filter(
      (z) => z.ballPathClear,
    );
    const targets = zones.map(zc => ({ pocket: zc.pocket, zc, zcPot: zc }));
    let best = { e: 0, landing: g.ghost };
    for (const c of routeCandidates(g, [ball9], targets, INTERMEDIATE, true)) {
      if (c.type !== type) continue;
      const e = expectedNextPot(g.ghost, c.dir, c.travel, type, c.rails, [ball9],
        c.zc, INTERMEDIATE, g.dCueGhost, { g, pocket }, undefined, false, c.sidespin) *
        c.ease * c.windowFactor;
      if (e > best.e) best = { e, landing: c.landing };
    }
    return best;
  }

  it('maximum draw beats the timid touch of low, landing well closer to the 9', () => {
    const draw = bestRoute('draw');
    const lowTouch = bestRoute('lowTouch');
    expect(draw.e).toBeGreaterThan(1.02 * lowTouch.e); // clear of the tie-break
    // Both strokes can reach deep into the window. Full draw still wins
    // after pricing physical hit power, pot speed, and window margin.
    expect(dist(draw.landing, ball9)).toBeLessThan(50);
    // aggressive, but with margin: never on top of the 9
    expect(dist(draw.landing, ball9)).toBeGreaterThan(10);
  });

  it('the full solver closes most of the gap to the 9 from ball in hand', () => {
    const layout: Layout = {
      seed: 0,
      balls: [
        { num: 8, pos: ball8 },
        { num: 9, pos: ball9 },
      ],
    };
    const pattern = solve(layout, INTERMEDIATE);
    expect(pattern).not.toBeNull();
    const first = pattern!.shots[0];
    expect(first.landing).not.toBeNull();
    // within position-window reach of the 9, margin kept
    expect(dist(first.landing!, ball9)).toBeLessThan(35);
    expect(dist(first.landing!, ball9)).toBeGreaterThan(10);
  });
});
