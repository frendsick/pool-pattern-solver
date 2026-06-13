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

/**
 * Roll/draw share MAGNITUDE of the cue ball's post-contact speed along the aim
 * line — the unsigned twin of signedRollShare, which owns the actual values.
 */
function rollShare(type: ShotType): number {
  return Math.abs(signedRollShare(type));
}

/**
 * SIGNED roll share: positive along the aim line (follow), negative against
 * it (draw, touch of low), zero for stun. The sign matters for the carom
 * direction's sensitivity to contact error (caromDirSigma in skill.ts).
 */
export function signedRollShare(type: ShotType): number {
  switch (type) {
    case 'stop':
    case 'stun':
      return 0;
    case 'follow':
      return 2 / 7;
    case 'lowTouch':
      return -(2 / 7) * LOW_TOUCH;
    case 'draw':
      return -2 / 7;
  }
}

/**
 * Cloth friction ratio µ_roll / µ_slide (pooltool defaults 0.01 / 0.2). Sets
 * how much of the cue ball's post-contact travel is spent sliding on the
 * tangent-line parabola before natural roll takes over on the carom line.
 */
export const SLIDE_ROLL_RATIO = 0.05;
const CURVE_SEGS = 6;

export interface CaromCurve {
  /** Slide-phase polyline, offsets from the contact point (origin excluded). */
  offsets: Vec[];
  /** Arc length of the slide phase; the carom line follows for the rest. */
  arc: number;
}

interface CaromUnit {
  /** Unit-scale slide parabola (offsets from the ghost). */
  pts: Vec[];
  arc: number;
  /** Unit-scale rolling distance after the slide: p² / (2·SLIDE_ROLL_RATIO). */
  roll: number;
  /** Direction ghost -> landing — the same for every travel (see caromLocus). */
  locusDir: Vec;
  /** Straight-line landing distance per unit of path travel (≲ 1). */
  eta: number;
}

/**
 * The 30-degree-rule trajectory (pooltool 30_degree_rule example): off the
 * object ball the cue ball departs ALONG THE TANGENT LINE, then sliding
 * friction bends it on a parabola into the type's carom line (departureDir).
 * With impact spin k (fraction of natural roll: follow 1, stun 0, recovered
 * from signedRollShare for draw/lowTouch so the carom lines stay exactly the
 * calibrated ones), the slide phase in (tangent, aim) components is
 *   r(τ) = (2q/7)·[ s·(τ − τ²(1−k)/7)·t̂ + (τ²·k·c/7)·â ],  τ ∈ [0,1],
 *   q = |(1−k)·s, k·c|  (slip speed share),  s = sin cut, c = cos cut,
 * after which the ball rolls p·v straight along departureDir, p² the speed
 * share it kept. Every term scales with v², so the SHAPE is speed-invariant:
 * the whole path just scales linearly with the chosen travel.
 */
function caromUnit(g: ShotGeometry, type: ShotType): CaromUnit | null {
  const r = signedRollShare(type);
  const s = Math.sin(g.cut);
  const c = Math.cos(g.cut);
  // Stun slides straight down the tangent; a near-straight shot's slide is
  // collinear with its carom line — no curve either way.
  if (r === 0 || s < 0.03) return null;
  const k = (5 * r) / (2 - 2 * r);
  const q = Math.hypot((1 - k) * s, k * c);
  const pts: Vec[] = [];
  let arc = 0;
  let prev: Vec = { x: 0, y: 0 };
  for (let i = 1; i <= CURVE_SEGS; i++) {
    const tau = i / CURVE_SEGS;
    const ct = ((2 * q) / 7) * s * (tau - (tau * tau * (1 - k)) / 7);
    const ca = ((2 * q) / 7) * ((tau * tau * k * c) / 7);
    const p = add(scale(g.tangent, ct), scale(g.aim, ca));
    arc += dist(prev, p);
    pts.push(p);
    prev = p;
  }
  const p2 = ((s * (5 + 2 * k)) / 7) ** 2 + ((2 * k * c) / 7) ** 2;
  const roll = p2 / (2 * SLIDE_ROLL_RATIO);
  const dir = departureDir(g, type)!;
  const locus = add(prev, scale(dir, roll));
  const len = Math.hypot(locus.x, locus.y);
  return { pts, arc, roll, locusDir: scale(locus, 1 / len), eta: len / (arc + roll) };
}

/**
 * The slide-phase curve for a route of the given post-contact travel, ready
 * for tracePath. Null when the path is straight anyway (stop/stun/near-straight).
 */
export function caromCurve(g: ShotGeometry, type: ShotType, travel: number): CaromCurve | null {
  const u = caromUnit(g, type);
  if (!u || travel <= 1e-6) return null;
  const L = travel / (u.arc + u.roll);
  return { offsets: u.pts.map((p) => scale(p, L)), arc: u.arc * L };
}

export interface CaromLocus {
  dir: Vec;
  /** Straight-line distance covered per unit of path travel (≲ 1). */
  eta: number;
}

/**
 * Because the carom path scales linearly with travel, the landings of ALL
 * travels lie on one straight ray from the ghost (pre-rail). Walking this
 * locus prices every candidate landing exactly with a single trace; rails
 * fold it like any line (exact where the path's own rail contact matches the
 * locus crossing — within a couple of inches, second order in the slide).
 */
export function caromLocus(g: ShotGeometry, type: ShotType): CaromLocus | null {
  const dir = departureDir(g, type);
  if (!dir) return null;
  const u = caromUnit(g, type);
  return u ? { dir: u.locusDir, eta: u.eta } : { dir, eta: 1 };
}

export function minCueTravel(g: ShotGeometry, type: ShotType): number {
  if (type === 'stop') return 0; // firm stun, the object ball takes it all
  const k = rollShare(type);
  const tan2 = Math.tan(g.cut) ** 2;
  return (tan2 + k * k) * g.dBallPocket * POCKET_PACE;
}

/**
 * Equivalent roll-out distance of the HIT a route demands. The cue ball keeps
 * the tangent share (sin² cut) plus a roll share along the aim line. Follow
 * is powered through controllable top spin (linear k), so long straight-ish
 * follow is a real stroke; draw/low keep the older k² budget because backspin
 * retention is the hard part. Near-straight sideways stun still demands a
 * monster hit, and is priced by SkillProfile.hitComfort/hitMax.
 */
export function hitDistance(g: ShotGeometry, type: ShotType, cueTravel: number): number {
  if (type === 'stop') return 0; // its firm stun is not a powered route
  const k = rollShare(type);
  const s2 = Math.sin(g.cut) ** 2;
  const c2 = Math.cos(g.cut) ** 2;
  const rollPower = type === 'follow' ? k : k * k;
  return cueTravel / Math.max(s2 + rollPower * c2, 1e-9);
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
 * Trace the cue ball from `start` for `totalDist` inches of path, reflecting
 * off cushions. With a `curve`, the ball first follows the slide-phase
 * polyline (the tangent-line parabola of the 30-degree rule), then runs
 * straight along `dir0` — the carom line the curve feeds into. Stops early on
 * contact with an obstacle ball ('ball') or a pocket mouth ('scratch').
 */
export function tracePath(
  start: Vec,
  dir0: Vec,
  totalDist: number,
  obstacles: Vec[],
  maxRails = 4,
  curve?: CaromCurve,
): TraceResult {
  let pos = { ...start };
  let dir = norm(dir0);
  // Slide-phase vertices still ahead (absolute); mirrored with dir on rebounds.
  let pending: Vec[] = curve ? curve.offsets.map((o) => add(start, o)) : [];
  let remaining = totalDist;
  let rails = 0;
  const points: Vec[] = [{ ...pos }];

  while (remaining > 1e-6) {
    // Current straight piece: to the next slide vertex, then along dir.
    let segDir = dir;
    let segLen = Infinity;
    if (pending.length > 0) {
      const to = sub(pending[0], pos);
      segLen = Math.hypot(to.x, to.y);
      if (segLen < 1e-9) {
        pending.shift();
        continue;
      }
      segDir = scale(to, 1 / segLen);
    }

    // Distance to each cushion along segDir.
    let tWall = Infinity;
    let wall: 'x' | 'y' | null = null;
    if (segDir.x > 1e-9) {
      const t = (MAX_X - pos.x) / segDir.x;
      if (t < tWall) { tWall = t; wall = 'x'; }
    } else if (segDir.x < -1e-9) {
      const t = (MIN_X - pos.x) / segDir.x;
      if (t < tWall) { tWall = t; wall = 'x'; }
    }
    if (segDir.y > 1e-9) {
      const t = (MAX_Y - pos.y) / segDir.y;
      if (t < tWall) { tWall = t; wall = 'y'; }
    } else if (segDir.y < -1e-9) {
      const t = (MIN_Y - pos.y) / segDir.y;
      if (t < tWall) { tWall = t; wall = 'y'; }
    }

    const horizon = Math.min(remaining, tWall, segLen);

    // Obstacle balls: stop at first contact (center distance 2R).
    let tBall = Infinity;
    for (const ob of obstacles) {
      const t = rayCircleHit(pos, segDir, ob, 2 * BALL_R, horizon);
      if (t !== null && t < tBall) tBall = t;
    }

    // Pocket mouths: entering one is a scratch.
    let tPocket = Infinity;
    for (const p of POCKETS) {
      const t = rayCircleHit(pos, segDir, p.target, p.captureRadius, horizon);
      if (t !== null && t < tPocket) tPocket = t;
    }

    const tStop = Math.min(horizon, tBall, tPocket);
    pos = add(pos, scale(segDir, tStop));
    points.push({ ...pos });
    remaining -= tStop;

    if (tPocket <= tStop + 1e-9 && tPocket <= tBall) {
      return { points, end: pos, rails, outcome: 'scratch', travelled: totalDist - remaining };
    }
    if (tBall <= tStop + 1e-9) {
      return { points, end: pos, rails, outcome: 'ball', travelled: totalDist - remaining };
    }
    if (remaining <= 1e-6) break;

    if (tWall <= tStop + 1e-9 && wall !== null) {
      // Cushion rebound: the slide dynamics mirror exactly with the table.
      rails += 1;
      if (rails > maxRails) {
        return { points, end: pos, rails, outcome: 'ok', travelled: totalDist - remaining };
      }
      const w = wall;
      const wx = pos.x;
      const wy = pos.y;
      pending = pending.map((p) =>
        w === 'x' ? { x: 2 * wx - p.x, y: p.y } : { x: p.x, y: 2 * wy - p.y },
      );
      dir = reflect(dir, w);
    } else if (pending.length > 0 && tStop >= segLen - 1e-9) {
      pending.shift(); // reached a slide vertex
    }
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
