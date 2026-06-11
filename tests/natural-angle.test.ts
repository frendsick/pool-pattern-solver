// Cut-angle ease heuristics (2026-06-12 feedback): shots get gradually
// harder past a 30 deg cut; the sweet spot for MOVING the cue ball sideways
// is a 15-30 deg cut (a rolling follow's carom direction is at its most
// controllable at the ~28 deg natural angle — the 30-degree-rule plateau);
// the kill-angle sweet spot (stopping near in place) is under ~10 deg.
// Plus: draw needs room for the spin to act before the first cushion.

import { describe, it, expect } from 'vitest';
import { vec, add, scale, rotate } from '../src/geometry';
import { pocketById, BALL_R, Layout } from '../src/table';
import { shotGeometry } from '../src/shots';
import {
  potProbability,
  caromDirSigma,
  drawRailFactor,
  INTERMEDIATE,
} from '../src/skill';
import { solve } from '../src/solver';

const ball = vec(50, 25);
const ts = pocketById('TS');
const gAt = (cueDist: number, cutDeg: number) => {
  const aimBack = vec(0, -1);
  const ghost = add(ball, scale(aimBack, 2 * BALL_R));
  const c = add(ghost, scale(rotate(aimBack, (cutDeg * Math.PI) / 180), cueDist));
  return shotGeometry(c, ball, ts)!;
};

describe('cuts get gradually harder past 30 degrees', () => {
  it('inside the sweet spot the pot barely changes, past it it slides', () => {
    const p = (cut: number) => potProbability(gAt(20, cut), ts, INTERMEDIATE);
    expect(p(28)).toBeGreaterThan(0.97 * p(15)); // flat below 30
    expect(p(40)).toBeLessThan(0.92 * p(28)); // already paying at 40
    expect(p(50)).toBeLessThan(0.78 * p(28)); // steep by 50
  });
});

describe('carom direction control (the moving-angle sweet spot)', () => {
  it('a rolling follow is most controllable at the ~28 deg natural angle', () => {
    const s = (cut: number) =>
      caromDirSigma(gAt(20, cut), 'follow', ts, INTERMEDIATE);
    expect(s(28)).toBeLessThan(s(10)); // near-straight follow is twitchy
    expect(s(28)).toBeLessThan(s(50)); // so are thin cuts
    expect(s(28)).toBeLessThan(0.005); // at the plateau: bare aim error
  });

  it('stun and draw carry the amplified contact error, follow does not', () => {
    const g = gAt(40, 28);
    const follow = caromDirSigma(g, 'follow', ts, INTERMEDIATE);
    const stun = caromDirSigma(g, 'stun', ts, INTERMEDIATE);
    const draw = caromDirSigma(g, 'draw', ts, INTERMEDIATE);
    expect(stun).toBeGreaterThan(5 * follow);
    expect(draw).toBeGreaterThan(stun);
  });
});

describe('draw needs room before the first cushion', () => {
  it('an early rail compromises draw, less so a touch of low, never follow', () => {
    expect(drawRailFactor('draw', 4, INTERMEDIATE)).toBeLessThan(0.8);
    expect(drawRailFactor('draw', INTERMEDIATE.drawRailRoom, INTERMEDIATE)).toBe(1);
    expect(drawRailFactor('lowTouch', 4, INTERMEDIATE)).toBeGreaterThan(
      drawRailFactor('draw', 4, INTERMEDIATE),
    );
    expect(drawRailFactor('follow', 4, INTERMEDIATE)).toBe(1);
    expect(drawRailFactor('draw', null, INTERMEDIATE)).toBe(1);
  });
});

describe('golden: natural-angle follow from ball in hand (2026-06-11 round 8)', () => {
  // 7 near the left rail, 9 below it, 8 far down-table: the player places
  // the cue ball BELOW the 7 for a ~30 deg cut into the top-left corner and
  // rolls a natural follow one rail to center table — NOT a draw, and not a
  // monster power route. The old model picked the draw because the landing
  // bar pruned the follow's stretch before reliability was priced in.
  it('plays the follow off the 7, not a draw', () => {
    const layout: Layout = {
      seed: 0,
      balls: [
        { num: 7, pos: vec(4.4, 27.9) },
        { num: 8, pos: vec(87.9, 17.0) },
        { num: 9, pos: vec(14.4, 15.0) },
      ],
    };
    const pattern = solve(layout, INTERMEDIATE);
    expect(pattern).not.toBeNull();
    const first = pattern!.shots[0];
    expect(first.type).toBe('follow');
    expect(first.cutDeg).toBeGreaterThan(15);
    expect(first.cutDeg).toBeLessThan(40);
    // the landing must sit inside the window the user is shown
    expect(first.windowRef).not.toBeNull();
  });
});
