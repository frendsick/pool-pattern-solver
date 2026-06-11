// Idealized cue-ball model (ADR-0001): four shot types fix the departure
// direction off the object ball; travel distance is the free speed parameter;
// rails rebound mirror-style. Rail rebound is kept behind `reflect` so a
// sidespin model can replace it later.

import {
  Vec,
  add,
  sub,
  scale,
  dot,
  norm,
  dist,
  rayCircleHit,
  segmentClearsCircle,
  angleBetween,
} from './geometry';
import { BALL_R, MIN_X, MAX_X, MIN_Y, MAX_Y, POCKETS, Pocket } from './table';

export type ShotType = 'stop' | 'follow' | 'stun' | 'lowTouch' | 'draw';

/** "Touch of low": fraction of full draw — a slight pull off the tangent. */
const LOW_TOUCH = 0.4;

export interface ShotGeometry {
  /** Unit aim line: object ball -> pocket target. */
  aim: Vec;
  /** Ghost-ball position: where the cue ball center sits at contact. */
  ghost: Vec;
  /** Unit cue ball travel direction: cue -> ghost. */
  cueDir: Vec;
  /** Cut angle in radians, [0, pi/2). */
  cut: number;
  /** Unit tangent: the perpendicular component of cueDir w.r.t. aim. */
  tangent: Vec;
  dCueGhost: number;
  dBallPocket: number;
}

export function shotGeometry(cue: Vec, ball: Vec, pocket: Pocket): ShotGeometry | null {
  const aim = norm(sub(pocket.target, ball));
  const ghost = sub(ball, scale(aim, 2 * BALL_R));
  const toGhost = sub(ghost, cue);
  const dCueGhost = Math.max(dist(cue, ghost), 1e-6);
  const cueDir = norm(toGhost);
  const cosCut = dot(cueDir, aim);
  if (cosCut <= 0.02) return null; // >~89 degrees: not a real shot
  const cut = Math.acos(Math.min(1, cosCut));
  const perp = sub(cueDir, scale(aim, cosCut));
  const tangent = norm(perp); // zero vector when dead straight
  return {
    aim,
    ghost,
    cueDir,
    cut,
    tangent,
    dCueGhost,
    dBallPocket: dist(ball, pocket.target),
  };
}

/**
 * Cue-ball departure direction off the object ball, per shot type.
 * Derived from the rolling/sliding ball model with full follow/draw:
 *   stun:     v ~ sin(cut) * tangent
 *   follow:   v ~ sin(cut) * tangent + (2/7) cos(cut) * aim
 *   draw:     v ~ sin(cut) * tangent - (2/7) cos(cut) * aim
 *   lowTouch: a touch of low — a fraction of full draw, just off the tangent
 * Returns null for a stun on a dead-straight shot (the cue ball stops:
 * that is the stop shot, handled as type 'stop').
 */
export function departureDir(g: ShotGeometry, type: ShotType): Vec | null {
  const s = Math.sin(g.cut);
  const c = Math.cos(g.cut);
  switch (type) {
    case 'stop':
      return null; // no travel by definition
    case 'stun': {
      if (s < 0.03) return null; // straight: stun degenerates to stop
      return norm(scale(g.tangent, s));
    }
    case 'follow':
      return norm(add(scale(g.tangent, s), scale(g.aim, (2 / 7) * c)));
    case 'lowTouch':
      return norm(sub(scale(g.tangent, s), scale(g.aim, (2 / 7) * LOW_TOUCH * c)));
    case 'draw':
      return norm(sub(scale(g.tangent, s), scale(g.aim, (2 / 7) * c)));
  }
}

/**
 * Minimum cue-ball travel after contact for a position route: the object
 * ball must still reach the pocket with margin (POCKET_PACE), and speed maps
 * to distance quadratically under constant friction, so the cue ball keeps
 * at least the matching share — you cannot "hit it really slowly" and pot.
 */
const POCKET_PACE = 1.25;

export function minCueTravel(g: ShotGeometry, type: ShotType): number {
  if (type === 'stop') return 0; // firm stun, the object ball takes it all
  const k =
    type === 'stun' ? 0 : type === 'lowTouch' ? (2 / 7) * LOW_TOUCH : 2 / 7;
  const tan2 = Math.tan(g.cut) ** 2;
  return (tan2 + k * k) * g.dBallPocket * POCKET_PACE;
}

export interface TraceResult {
  /** Polyline of the cue ball center, starting at the origin point. */
  points: Vec[];
  end: Vec;
  rails: number;
  outcome: 'ok' | 'ball' | 'scratch';
  /** Total distance actually travelled. */
  travelled: number;
}

function reflect(dir: Vec, wall: 'x' | 'y'): Vec {
  return wall === 'x' ? { x: -dir.x, y: dir.y } : { x: dir.x, y: -dir.y };
}

/**
 * Trace the cue ball from `start` along `dir0` for `totalDist` inches of path,
 * reflecting off cushions. Stops early on contact with an obstacle ball
 * ('ball') or when running into a pocket mouth ('scratch').
 */
export function tracePath(
  start: Vec,
  dir0: Vec,
  totalDist: number,
  obstacles: Vec[],
  maxRails = 4,
): TraceResult {
  let pos = { ...start };
  let dir = norm(dir0);
  let remaining = totalDist;
  let rails = 0;
  const points: Vec[] = [{ ...pos }];

  while (remaining > 1e-6) {
    // Distance to each cushion along dir.
    let tWall = Infinity;
    let wall: 'x' | 'y' | null = null;
    if (dir.x > 1e-9) {
      const t = (MAX_X - pos.x) / dir.x;
      if (t < tWall) { tWall = t; wall = 'x'; }
    } else if (dir.x < -1e-9) {
      const t = (MIN_X - pos.x) / dir.x;
      if (t < tWall) { tWall = t; wall = 'x'; }
    }
    if (dir.y > 1e-9) {
      const t = (MAX_Y - pos.y) / dir.y;
      if (t < tWall) { tWall = t; wall = 'y'; }
    } else if (dir.y < -1e-9) {
      const t = (MIN_Y - pos.y) / dir.y;
      if (t < tWall) { tWall = t; wall = 'y'; }
    }

    const horizon = Math.min(remaining, tWall);

    // Obstacle balls: stop at first contact (center distance 2R).
    let tBall = Infinity;
    for (const ob of obstacles) {
      const t = rayCircleHit(pos, dir, ob, 2 * BALL_R, horizon);
      if (t !== null && t < tBall) tBall = t;
    }

    // Pocket mouths: entering one is a scratch.
    let tPocket = Infinity;
    for (const p of POCKETS) {
      const t = rayCircleHit(pos, dir, p.target, p.captureRadius, horizon);
      if (t !== null && t < tPocket) tPocket = t;
    }

    const tStop = Math.min(horizon, tBall, tPocket);
    pos = add(pos, scale(dir, tStop));
    points.push({ ...pos });
    remaining -= tStop;

    if (tPocket <= tStop + 1e-9 && tPocket <= tBall) {
      return { points, end: pos, rails, outcome: 'scratch', travelled: totalDist - remaining };
    }
    if (tBall <= tStop + 1e-9) {
      return { points, end: pos, rails, outcome: 'ball', travelled: totalDist - remaining };
    }
    if (remaining <= 1e-6) break;

    // Cushion rebound.
    if (wall === null) break;
    rails += 1;
    if (rails > maxRails) {
      return { points, end: pos, rails, outcome: 'ok', travelled: totalDist - remaining };
    }
    dir = reflect(dir, wall);
  }

  return { points, end: pos, rails, outcome: 'ok', travelled: totalDist };
}

/** True if the object ball has an unobstructed straight path to the pocket. */
export function ballPathToPocketClear(ball: Vec, pocket: Pocket, others: Vec[]): boolean {
  for (const o of others) {
    if (!segmentClearsCircle(ball, pocket.target, o, 2 * BALL_R)) return false;
  }
  return true;
}

/** True if the cue ball can reach the ghost position without hitting others. */
export function cuePathClear(cue: Vec, ghost: Vec, others: Vec[]): boolean {
  for (const o of others) {
    if (!segmentClearsCircle(cue, ghost, o, 2 * BALL_R)) return false;
  }
  return true;
}

/** Deviation of the ball's arrival direction from the pocket facing, radians. */
export function approachDeviation(aim: Vec, pocket: Pocket): number {
  return angleBetween(aim, pocket.facing);
}
