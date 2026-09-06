import { describe, it, expect } from 'vitest';
import { vec, add, scale, norm, sub, rotate, dist } from '../src/geometry';
import { Layout, MIN_X, MAX_X, MIN_Y, MAX_Y, pocketById } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { routeCandidates, zoneTargets } from '../src/route';
import { solve } from '../src/solver';
import { shotGeometry, traceShot } from '../src/shots';
import { surfacesForLayout } from '../src/value';

const layout: Layout = {
  seed: 791175205,
  balls: [
    { num: 5, pos: vec(75.3094895069371, 10.944515586947091) },
    { num: 6, pos: vec(9.644633474992588, 23.86299910431262) },
    { num: 7, pos: vec(41.6190182613791, 28.5393512378796) },
    { num: 8, pos: vec(94.99240890878718, 11.97652654047124) },
    { num: 9, pos: vec(32.09963130642427, 46.25752083142288) },
  ],
};

function handGeometry(pid: 'BL' | 'TS', signedCutDeg: number) {
  const five = layout.balls[0];
  const pocket = pocketById(pid);
  const aim = norm(sub(pocket.target, five.pos));
  const ghost = sub(five.pos, scale(aim, 2.25));
  const cue = add(ghost, scale(rotate(scale(aim, -1), (signedCutDeg * Math.PI) / 180), 8));
  const g = shotGeometry(cue, five.pos, pocket);
  if (!g) throw new Error('invalid hand geometry');
  return { pocket, cue, g };
}

function firstShotTargets(balls = layout.balls) {
  const surfaces = surfacesForLayout({ ...layout, balls }, INTERMEDIATE);
  return zoneTargets(balls, 1, surfaces, INTERMEDIATE);
}

function railPoints(path: { x: number; y: number }[]) {
  return path.filter(
    (p) =>
      p.x <= MIN_X + 0.01 ||
      p.x >= MAX_X - 0.01 ||
      p.y <= MIN_Y + 0.01 ||
      p.y >= MAX_Y - 0.01,
  );
}

describe('handball long follow fallback (seed 791175205)', () => {
  it('route discovery sees the curved 5 -> BL follow into the lower 6 window', () => {
    const { g } = handGeometry('BL', -30);
    const obstacles = layout.balls.slice(1).map((b) => b.pos);
    const candidates = routeCandidates(
      g,
      obstacles,
      firstShotTargets(),
      INTERMEDIATE,
      false,
    );

    expect(candidates.some((c) =>
      c.type === 'follow' &&
      c.nextPocket.id === 'TL' &&
      c.rails >= 1 &&
      c.travel > 90 &&
      c.landing.x < 25 &&
      c.landing.y < 18
    )).toBe(true);
  });

  it('with the 9 removed as a blocker, the top-side follow line near its old spot is available', () => {
    const ballsNoNine = layout.balls.filter((b) => b.num !== 9);
    const oldNine = layout.balls[4].pos;
    const { g } = handGeometry('TS', -30);
    const obstacles = ballsNoNine.slice(1).map((b) => b.pos);
    const candidates = routeCandidates(
      g,
      obstacles,
      firstShotTargets(ballsNoNine),
      INTERMEDIATE,
      true,
    );

    const nearOldNine = candidates.some((c) => {
      if (c.type !== 'follow' || c.rails < 1 || c.travel < 130) return false;
      const tr = traceShot(g, c.type, c.travel, obstacles, { maxRails: 4, sidespin: c.sidespin });
      if (tr.outcome !== 'ok') return false;
      return railPoints(tr.points).some((p) => dist(p, oldNine) < 12);
    });
    expect(nearOldNine).toBe(true);
  });

  it('solves the complete Pattern with the long bottom-left follow', () => {
    const pattern = solve(layout, INTERMEDIATE);
    expect(pattern).not.toBeNull();
    const first = pattern!.shots[0];
    // Cushion losses and pot speed change the downstream route costs.
    expect(first.pocket.id).toBe('BL');
    expect(first.type).toBe('follow');
    expect(first.rails).toBe(1);
    expect(first.travel).toBeGreaterThan(90);
    expect(first.travel).toBeLessThan(110);
    expect(first.landing!.x).toBeLessThan(30);
    expect(first.zoneLen!).toBeGreaterThan(7);
    expect(pattern!.score).toBeGreaterThan(0.08);
  });
});
