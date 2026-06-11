// Basic 2D vector helpers. Units throughout the project are inches.

export interface Vec {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export function norm(a: Vec): Vec {
  const l = len(a);
  if (l < 1e-12) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

export function rotate(a: Vec, angle: number): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** Angle between two vectors, in radians, in [0, pi]. */
export function angleBetween(a: Vec, b: Vec): number {
  return Math.acos(clamp(dot(norm(a), norm(b)), -1, 1));
}

/** Distance from point p to segment [a, b]. */
export function distPointSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12), 0, 1);
  return dist(p, add(a, scale(ab, t)));
}

/** True if segment [a, b] stays at least `clearance` away from circle center c. */
export function segmentClearsCircle(a: Vec, b: Vec, c: Vec, clearance: number): boolean {
  return distPointSegment(c, a, b) >= clearance;
}

/**
 * First intersection parameter t (distance along the ray) where a ray from
 * `origin` along unit `dir` comes within `radius` of `center`, or null.
 */
export function rayCircleHit(
  origin: Vec,
  dir: Vec,
  center: Vec,
  radius: number,
  maxT: number,
): number | null {
  const oc = sub(origin, center);
  const b = dot(oc, dir);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = -b - sq;
  const t2 = -b + sq;
  const t = t1 >= 1e-9 ? t1 : t2 >= 1e-9 ? t2 : null;
  if (t === null || t > maxT) return null;
  return t;
}
