// Golden Scenarios: principle checks reconstructed from the
// knowledgebase articles. The solver must agree with what the articles teach.

import { describe, it, expect } from 'vitest';
import { vec, add, scale, norm, sub, rotate } from '../src/geometry';
import { pocketById, Layout } from '../src/table';
import { zoneContext } from '../src/zone';
import { INTERMEDIATE } from '../src/skill';
import { expectedNextPot, solve } from '../src/solver';

describe('golden: come into the line of the shot (PoolDawg / Dr. Dave #4)', () => {
  // Next shot: ball at (60,25) into the bottom-right corner. The position
  // zone stretches up-left along the line of the shot, pinched laterally by
  // two obstacle balls. A route arriving ALONG the line tolerates speed
  // error; the same landing point reached ACROSS the line does not.
  const ball = vec(60, 25);
  const pocket = pocketById('BR');
  const aim = norm(sub(pocket.target, ball));
  const aimBack = scale(aim, -1);
  const perp = rotate(aim, Math.PI / 2);
  const landing = add(ball, scale(aimBack, 15));
  const obstacles = [
    add(add(landing, scale(perp, 4.5)), scale(aim, 5)),
    add(add(landing, scale(perp, -4.5)), scale(aim, 5)),
  ];
  const zc = zoneContext(ball, pocket, obstacles);

  it('the zone itself is open at the landing point', () => {
    const intoLine = expectedNextPot(
      add(landing, scale(aimBack, 0.01)), aim, 0.01, 'stop', 0,
      obstacles, zc, INTERMEDIATE,
    );
    expect(intoLine).toBeGreaterThan(0.5);
  });

  it('arriving along the line beats crossing it to the same point', () => {
    const startAlong = add(landing, scale(aimBack, 25));
    const eAlong = expectedNextPot(
      startAlong, aim, 25, 'stun', 0, obstacles, zc, INTERMEDIATE,
    );
    const startAcross = add(landing, scale(perp, -25));
    const eAcross = expectedNextPot(
      startAcross, perp, 25, 'stun', 0, obstacles, zc, INTERMEDIATE,
    );
    expect(eAlong).toBeGreaterThan(0.7);
    expect(eAlong).toBeGreaterThan(1.3 * eAcross);
  });
});

describe('golden: cushions act as brakes (Dr. Dave #5)', () => {
  // Same intended landing and total travel: a route that takes a cushion
  // before landing has its speed error damped, so its expectation is at
  // least as good as the same-length rail-free route — all else equal.
  const ball = vec(60, 25);
  const pocket = pocketById('BR');
  const aim = norm(sub(pocket.target, ball));
  const aimBack = scale(aim, -1);
  const zc = zoneContext(ball, pocket, []);
  const landing = add(ball, scale(aimBack, 12));

  it('distance sigma shrinks when a rail is used', () => {
    const direct = expectedNextPot(
      add(landing, scale(aimBack, 40)), aim, 40, 'stun', 0, [], zc, INTERMEDIATE,
    );
    const braked = expectedNextPot(
      add(landing, scale(aimBack, 40)), aim, 40, 'stun', 1, [], zc, INTERMEDIATE,
    );
    expect(braked).toBeGreaterThanOrEqual(direct);
  });
});

describe('golden: open three-ball layout solves confidently', () => {
  it('solves 7-8-9 spread across the table', () => {
    const layout: Layout = {
      seed: 0,
      balls: [
        { num: 7, pos: vec(25, 35) },
        { num: 8, pos: vec(50, 15) },
        { num: 9, pos: vec(75, 35) },
      ],
    };
    const pattern = solve(layout, INTERMEDIATE);
    expect(pattern).not.toBeNull();
    const shots = pattern!.shots;
    expect(shots.map((s) => s.ball.num)).toEqual([7, 8, 9]);
    expect(pattern!.score).toBeGreaterThan(0.2);
    for (const s of shots) {
      expect(s.potProb).toBeGreaterThan(0.4);
      expect(s.cuePos.x).toBeGreaterThan(0);
      expect(s.cuePos.x).toBeLessThan(100);
    }
    // every shot has an explanation for the UI
    for (const s of shots) expect(s.explanation.length).toBeGreaterThan(10);
  });
});
