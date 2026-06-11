// Scratch risk is direction-aware (2026-06-12 round 12, seed 663545194):
// a route that rebounds off the cushion just beside a pocket mouth is NOT
// skimming it — the jaws only funnel a ball arriving within the pocket's
// acceptance cone; beyond it the ball meets cushion-backed facings and stays
// on the table. The old distance-only pocketRisk shaved ~10% off the
// player's preferred ball-in-hand follow (bottom rail, rebounding up the
// 8's shot line, long in the window) and let a left-rail follow that merely
// CROSSES the window win instead.

import { describe, it, expect } from 'vitest';
import { vec } from '../src/geometry';
import { Layout, MIN_Y } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';

describe('golden: bottom-rail follow into the line (2026-06-12 round 12)', () => {
  // 7 near the left rail (BL corner pot), 8 and 9 down-table right. Ball in
  // hand: the player spots the cue ball up-LEFT of the 7 so the natural
  // follow drops to the bottom rail and rebounds up the 8's shot line —
  // the rebound passes half a diamond from the bottom-side pocket at ~48
  // deg to its facing, which is safe, not a scratch risk.
  it('plays the follow off the bottom rail, coming into the line', () => {
    const layout: Layout = {
      seed: 0,
      balls: [
        { num: 7, pos: vec(8.4, 28.7) },
        { num: 8, pos: vec(75.1, 32.1) },
        { num: 9, pos: vec(83.0, 15.7) },
      ],
    };
    const pattern = solve(layout, INTERMEDIATE);
    expect(pattern).not.toBeNull();
    const first = pattern!.shots[0];
    expect(first.type).toBe('follow');
    expect(first.rails).toBe(1);
    // cue spotted left, above the 7 — not up-right of it
    expect(first.cuePos.x).toBeLessThan(10);
    // the one rail is the BOTTOM rail, short of the side pocket
    const railPt = first.path!.reduce((a, b) => (b.y < a.y ? b : a));
    expect(railPt.y).toBeLessThan(MIN_Y + 0.5);
    expect(railPt.x).toBeGreaterThan(35);
    expect(railPt.x).toBeLessThan(48);
    // and the rebound runs ALONG the 8's shot line, not across the window
    expect(first.entryDeg).not.toBeNull();
    expect(first.entryDeg!).toBeLessThanOrEqual(20);
    expect(first.eNext!).toBeGreaterThan(0.85);
  });
});
