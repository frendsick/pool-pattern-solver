import { Vec, add, clamp, dist, scale, sub } from './geometry';
import { Ball, BALL_R, MAX_X, MAX_Y, MIN_X, MIN_Y, onTable } from './table';

const EPS = 0.01;

export function wholeTablePolygon(): Vec[] {
  return [
    { x: MIN_X, y: MIN_Y },
    { x: MAX_X, y: MIN_Y },
    { x: MAX_X, y: MAX_Y },
    { x: MIN_X, y: MAX_Y },
  ];
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const crosses = a.y > p.y !== b.y > p.y;
    if (!crosses) continue;
    const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (p.x < x) inside = !inside;
  }
  return inside;
}

function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const t = clamp(
    ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) /
      Math.max(ab.x * ab.x + ab.y * ab.y, 1e-12),
    0,
    1,
  );
  return add(a, scale(ab, t));
}

function clampToPolygons(p: Vec, polygons: Vec[][]): Vec {
  const legal = {
    x: clamp(p.x, MIN_X, MAX_X),
    y: clamp(p.y, MIN_Y, MAX_Y),
  };
  const polys = polygons.length > 0 ? polygons : [wholeTablePolygon()];
  if (polys.some((poly) => pointInPolygon(legal, poly))) return legal;

  let best = legal;
  let bestD = Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const q = closestPointOnSegment(legal, poly[i], poly[(i + 1) % poly.length]);
      const d = dist(legal, q);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
  }
  return {
    x: clamp(best.x, MIN_X, MAX_X),
    y: clamp(best.y, MIN_Y, MAX_Y),
  };
}

export function clampCuePosition(p: Vec, polygons: Vec[][], balls: Ball[]): Vec {
  let q = clampToPolygons(p, polygons);
  const minDist = 2 * BALL_R + EPS;
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (const b of balls) {
      const d = dist(q, b.pos);
      if (d >= minDist) continue;
      const dir = d > 1e-9 ? scale(sub(q, b.pos), 1 / d) : { x: 1, y: 0 };
      q = add(b.pos, scale(dir, minDist));
      moved = true;
    }
    q = clampToPolygons(q, polygons);
    if (!moved) break;
  }
  return q;
}

export function legalCuePosition(p: Vec, balls: Ball[]): boolean {
  if (!onTable(p)) return false;
  const minDist = 2 * BALL_R + EPS;
  return balls.every((b) => dist(p, b.pos) >= minDist - 1e-9);
}

export function pointInPolygons(p: Vec, polygons: Vec[][]): boolean {
  return polygons.some((poly) => pointInPolygon(p, poly));
}
