// Round 20 (2026-06-12, image #31): "make the tool try to find paths along
// the shotline a bit more aggressively" — and especially from ball in hand,
// where the player spots the cue ball for an exact, rehearsed carom. Three
// mechanisms: (a) shotline-aligned placement seeds solved against the next
// ball's shot lines (the fixed grid quantizes the cut 10-15 deg apart and
// misses the fold cuts), (b) SkillProfile.handDirEase shrinks the non-cushion
// direction noise of routes played from hand, (c) alignBoost prefers
// along-the-line window entries on sortKey near-ties (never in the score).

import { describe, it, expect } from 'vitest';
import { vec, sub, norm, angleBetween } from '../src/geometry';
import { Layout, pocketById } from '../src/table';
import { INTERMEDIATE, directionSigma } from '../src/skill';
import { initialNodes, expandNodes, zoneTargets } from '../src/solver';
import { shotGeometry } from '../src/shots';
import { surfacesForLayout, gateFor } from '../src/value';

const layout: Layout = {
  seed: 0,
  balls: [
    { num: 5, pos: vec(56.35, 15.72) },
    { num: 6, pos: vec(93.8, 19.07) },
    { num: 7, pos: vec(76.97, 19.82) },
    { num: 8, pos: vec(39.26, 25.78) },
    { num: 9, pos: vec(49.47, 24.93) },
  ],
};

describe('ball-in-hand carom accuracy (handDirEase)', () => {
  it('eases the stroke/carom part of direction noise, never the cushion part', () => {
    const g = shotGeometry(vec(54.1, 6.0), layout.balls[0].pos, pocketById('TS'))!;
    const carom = { g, pocket: pocketById('TS') };
    const leave = directionSigma('follow', 0, INTERMEDIATE, g.dCueGhost, carom);
    const hand = directionSigma('follow', 0, INTERMEDIATE, g.dCueGhost, carom, true);
    expect(hand).toBeCloseTo(leave * INTERMEDIATE.handDirEase, 9);
    // with a cushion the additive rebound noise stays the table's
    const leave1 = directionSigma('follow', 1, INTERMEDIATE, g.dCueGhost, carom);
    const hand1 = directionSigma('follow', 1, INTERMEDIATE, g.dCueGhost, carom, true);
    expect(leave1 - leave).toBeCloseTo(INTERMEDIATE.railDirSigma, 9);
    expect(hand1 - hand).toBeCloseTo(INTERMEDIATE.railDirSigma, 9);
  });
});

describe('shotline-aligned seeds (image #31)', () => {
  const surfaces = surfacesForLayout(layout, INTERMEDIATE);
  const targets = zoneTargets(
    layout.balls[1], layout.balls.slice(2), INTERMEDIATE, gateFor(surfaces, 2),
  );

  it('seeds the 5 -> TS fold cut the fixed grid misses', () => {
    const nodes = initialNodes(layout, INTERMEDIATE, gateFor(surfaces, 1), targets);
    const tsCuts = nodes
      .filter((n) => n.pending.pocket.id === 'TS')
      .map((n) => (n.pending.g.cut * 180) / Math.PI);
    // The user's "less angle, one rail off the top, down the 6's line" lives
    // at a ~11-16 deg cut; the grid only offers 10 and 20.
    expect(tsCuts.some((c) => c > 10.5 && c < 16.5)).toBe(true);
    // and without next-ball targets the grid alone does not have it
    const bare = initialNodes(layout, INTERMEDIATE, gateFor(surfaces, 1));
    const bareCuts = bare
      .filter((n) => n.pending.pocket.id === 'TS')
      .map((n) => (n.pending.g.cut * 180) / Math.PI);
    expect(bareCuts.some((c) => c > 10.5 && c < 16.5)).toBe(false);
  });

  it('the top-rail fold down the 6 -> BR line is generated and priced as a real route', () => {
    const nodes = initialNodes(layout, INTERMEDIATE, gateFor(surfaces, 1), targets);
    const children = expandNodes(
      nodes, layout.balls[1], layout.balls.slice(2), INTERMEDIATE, gateFor(surfaces, 2),
    );
    const line = norm(sub(pocketById('BR').target, layout.balls[1].pos));
    const folds = children.filter((n) => {
      const s = n.done[0];
      if (s.pocket.id !== 'TS' || s.type !== 'follow' || s.rails < 1) return false;
      if (s.cutDeg > 18) return false;
      const path = s.path!;
      const leg = sub(path[path.length - 1], path[path.length - 2]);
      const a = angleBetween(leg, line);
      return Math.min(a, Math.PI - a) < (20 * Math.PI) / 180;
    });
    expect(folds.length).toBeGreaterThan(0);
    // priced as a serious candidate, not a leftover (was unseeded before)
    expect(Math.max(...folds.map((n) => n.done[0].eNext ?? 0))).toBeGreaterThan(0.7);
  });
});
