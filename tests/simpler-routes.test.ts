import { describe, it, expect } from 'vitest';
import { vec, dist } from '../src/geometry';
import { Layout } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';

// Seed 349500940, 5 balls (round after the long-follow calibration): the
// solver had started stringing together long follow routes, including a
// two-rail follow on the 7 when a short touch/stun route toward the 8 was
// available.
describe('simpler routes over long multi-rail follow', () => {
  const layout: Layout = {
    seed: 349500940,
    balls: [
      { num: 5, pos: vec(56.86, 15.69) },
      { num: 6, pos: vec(95.00, 19.10) },
      { num: 7, pos: vec(77.85, 19.85) },
      { num: 8, pos: vec(38.49, 24.95) },
      { num: 9, pos: vec(49.84, 25.07) },
    ],
  };

  it('does not choose the old long-follow chain', () => {
    const pattern = solve(layout, INTERMEDIATE);
    expect(pattern).not.toBeNull();

    const [, , s3] = pattern!.shots;
    expect(s3.ball.num).toBe(7);
    expect(s3.rails).toBeLessThanOrEqual(1);
    expect(!(s3.type === 'follow' && s3.rails >= 2)).toBe(true);
    expect(s3.travel).toBeLessThan(70);
    expect(dist(s3.landing!, layout.balls[2].pos)).toBeLessThan(55);
    expect(pattern!.score).toBeGreaterThan(0.17);
  });

  it('uses short routes when stop or draw is already in the next window', () => {
    const pattern = solve({
      seed: 569419188,
      balls: [
        { num: 5, pos: vec(9.26, 4.84) },
        { num: 6, pos: vec(56.51, 11.42) },
        { num: 7, pos: vec(73.98, 44.27) },
        { num: 8, pos: vec(34.19, 44.44) },
        { num: 9, pos: vec(51.28, 16.25) },
      ],
    }, INTERMEDIATE);
    expect(pattern).not.toBeNull();

    const s7 = pattern!.shots[2];
    const s8 = pattern!.shots[3];
    expect(s7.ball.num).toBe(7);
    expect(['draw', 'lowTouch', 'stun', 'stop']).toContain(s7.type);
    expect(s7.rails).toBe(0);
    expect(s7.travel).toBeLessThan(30);
    expect(dist(s7.landing!, s7.ball.pos)).toBeLessThan(30);

    expect(s8.ball.num).toBe(8);
    expect(['draw', 'lowTouch', 'stun', 'stop']).toContain(s8.type);
    expect(s8.rails).toBe(0);
    expect(s8.travel).toBeLessThan(30);
    expect(pattern!.score).toBeGreaterThan(0.2);
  });

  it('does not prefer rail follow when the 8 is already in the 9 window', () => {
    const pattern = solve({
      seed: 336928854,
      balls: [
        { num: 5, pos: vec(83.13, 34.05) },
        { num: 6, pos: vec(24.19, 43.69) },
        { num: 7, pos: vec(30.87, 13.26) },
        { num: 8, pos: vec(77.76, 16.20) },
        { num: 9, pos: vec(29.34, 6.57) },
      ],
    }, INTERMEDIATE);
    expect(pattern).not.toBeNull();

    const s7 = pattern!.shots[2];
    const s8 = pattern!.shots[3];
    expect(s7.ball.num).toBe(7);
    expect(['draw', 'lowTouch', 'stun', 'stop']).toContain(s7.type);
    expect(s7.rails).toBe(0);
    expect(s7.travel).toBeLessThan(35);

    expect(s8.ball.num).toBe(8);
    expect(['draw', 'lowTouch', 'stun', 'stop']).toContain(s8.type);
    expect(s8.rails).toBe(0);
    expect(s8.travel).toBeLessThan(30);
    expect(dist(s8.landing!, s8.ball.pos)).toBeLessThan(25);
    expect(pattern!.score).toBeGreaterThan(0.15);
  });
});
