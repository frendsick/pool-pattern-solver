import { describe, it, expect } from 'vitest';
import {
  vec,
  distPointSegment,
  segmentClearsCircle,
  rayCircleHit,
  angleBetween,
} from '../src/geometry';

describe('geometry', () => {
  it('distPointSegment: perpendicular and clamped cases', () => {
    expect(distPointSegment(vec(5, 5), vec(0, 0), vec(10, 0))).toBeCloseTo(5);
    expect(distPointSegment(vec(-3, 4), vec(0, 0), vec(10, 0))).toBeCloseTo(5);
  });

  it('segmentClearsCircle honors the clearance distance', () => {
    expect(segmentClearsCircle(vec(0, 0), vec(10, 0), vec(5, 3), 2.25)).toBe(true);
    expect(segmentClearsCircle(vec(0, 0), vec(10, 0), vec(5, 2), 2.25)).toBe(false);
  });

  it('rayCircleHit finds the near intersection', () => {
    const t = rayCircleHit(vec(0, 0), vec(1, 0), vec(10, 0), 2, 100);
    expect(t).toBeCloseTo(8);
    expect(rayCircleHit(vec(0, 0), vec(1, 0), vec(10, 5), 2, 100)).toBeNull();
  });

  it('angleBetween', () => {
    expect(angleBetween(vec(1, 0), vec(0, 1))).toBeCloseTo(Math.PI / 2);
  });
});
