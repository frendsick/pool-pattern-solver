import { describe, expect, it } from 'vitest';
import { dist, vec } from '../src/geometry';
import {
  clampCuePosition,
  legalCuePosition,
  pointInPolygon,
  wholeTablePolygon,
} from '../src/interaction';
import { svgToTablePoint, tableToSvgPoint } from '../src/render';
import { BALL_R, Ball, MAX_X, MAX_Y, MIN_X, MIN_Y } from '../src/table';

describe('cue-ball drag geometry', () => {
  it('round-trips table inches through the SVG coordinate transform', () => {
    const table = vec(37.25, 14.5);
    const svg = tableToSvgPoint(table);
    const back = svgToTablePoint(svg);

    expect(back.x).toBeCloseTo(table.x);
    expect(back.y).toBeCloseTo(table.y);
  });

  it('recognizes points inside the rendered origin polygon', () => {
    const poly = [
      vec(10, 10),
      vec(20, 10),
      vec(20, 20),
      vec(10, 20),
    ];

    expect(pointInPolygon(vec(15, 15), poly)).toBe(true);
    expect(pointInPolygon(vec(25, 15), poly)).toBe(false);
  });

  it('clamps to the legal table rectangle', () => {
    const p = clampCuePosition(vec(-50, 80), [wholeTablePolygon()], []);

    expect(p.x).toBe(MIN_X);
    expect(p.y).toBe(MAX_Y);
  });

  it('keeps the cue ball out of object balls while staying on the table', () => {
    const ball = { num: 7, pos: vec(20, 20) };
    const p = clampCuePosition(ball.pos, [wholeTablePolygon()], [ball]);

    expect(dist(p, ball.pos)).toBeGreaterThanOrEqual(2 * BALL_R);
    expect(p.x).toBeGreaterThanOrEqual(MIN_X);
    expect(p.x).toBeLessThanOrEqual(MAX_X);
    expect(p.y).toBeGreaterThanOrEqual(MIN_Y);
    expect(p.y).toBeLessThanOrEqual(MAX_Y);
  });
});

describe('cue placement legality', () => {
  const balls: Ball[] = [{ num: 7, pos: vec(25, 25) }];

  it('accepts only table-bounded cue centers clear of object balls', () => {
    expect(legalCuePosition(vec(MIN_X, MIN_Y), balls)).toBe(true);
    expect(legalCuePosition(vec(MIN_X - 0.1, MIN_Y), balls)).toBe(false);
    expect(legalCuePosition(vec(25 + 2 * BALL_R, 25), balls)).toBe(false);
    expect(legalCuePosition(vec(25 + 2 * BALL_R + 0.1, 25), balls)).toBe(true);
  });

  it('clamps opening drags to legal cue-center space', () => {
    const clamped = clampCuePosition(vec(25, 25), [wholeTablePolygon()], balls);

    expect(legalCuePosition(clamped, balls)).toBe(true);
    expect(dist(clamped, balls[0].pos)).toBeGreaterThanOrEqual(2 * BALL_R);
  });
});
