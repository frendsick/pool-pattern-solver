// Idealized cue-ball model (ADR-0001/0007): ShotType fixes the vertical
// departure behavior off the object ball, sidespin is an orthogonal left/right
// control, and travel distance is the free speed parameter.

import {
  Vec,
  add,
  sub,
  scale,
  dot,
  cross,
  norm,
  dist,
  rotate,
  rayCircleHit,
  segmentClearsCircle,
  angleBetween,
} from './geometry';
import { BALL_R, TABLE_W, TABLE_H, MIN_X, MAX_X, MIN_Y, MAX_Y, POCKETS, Pocket, onTable } from './table';

export type ShotType = 'stop' | 'follow' | 'stun' | 'lowTouch' | 'draw';

export const SIDESPINS = [-0.5, 0, 0.5] as const;
export type Sidespin = (typeof SIDESPINS)[number];
export const MAX_MODELED_SIDESPIN = Math.max(...SIDESPINS.map((s) => Math.abs(s)));

/** "Touch of low": fraction of full draw — a slight pull off the tangent. */
const LOW_TOUCH = 0.4;

export interface ShotGeometry {
  pocket: Pocket;
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
  if (!onTable(ghost)) return null;
  const toGhost = sub(ghost, cue);
  const dCueGhost = Math.max(dist(cue, ghost), 1e-6);
  const cueDir = norm(toGhost);
  const cosCut = dot(cueDir, aim);
  if (cosCut <= 0.02) return null; // >~89 degrees: not a real shot
  const cut = Math.acos(Math.min(1, cosCut));
  const perp = sub(cueDir, scale(aim, cosCut));
  const tangent = norm(perp); // zero vector when dead straight
  return {
    pocket,
    aim,
    ghost,
    cueDir,
    cut,
    tangent,
    dCueGhost,
    dBallPocket: dist(ball, pocket.target),
  };
}

/** Only a square hit can transfer all translational motion to the object ball. */
export const isStraight = (g: ShotGeometry): boolean => g.cut < 1e-6;

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
      if (isStraight(g)) return null;
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
export const POCKET_PACE = 1.25;

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
/** Roll-out share of a ball launched without spin, including its initial slide.
 * https://drdavepoolinfo.com/technical_proofs/TP_4-1.pdf
 */
const SLIDING_DISTANCE_SHARE = (25 + 24 * SLIDE_ROLL_RATIO) / 49;

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

// A geometry is fixed for the many travel samples in a route or zone scan.
const caromUnits = new WeakMap<ShotGeometry, Partial<Record<ShotType, CaromUnit>>>();

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
 * share it kept. Before cushions, every term scales with v², so the shape
 * scales linearly with the free-cloth travel equivalent of the impact energy.
 */
function caromUnit(g: ShotGeometry, type: ShotType): CaromUnit | null {
  const r = signedRollShare(type);
  const s = Math.sin(g.cut);
  const c = Math.cos(g.cut);
  // Stun slides straight down the tangent.
  if (r === 0) return null;
  const cached = caromUnits.get(g);
  if (cached?.[type]) return cached[type];
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
  const unit = { pts, arc, roll, locusDir: scale(locus, 1 / len), eta: len / (arc + roll) };
  caromUnits.set(g, { ...cached, [type]: unit });
  return unit;
}

/**
 * Slide curve at a given free-cloth travel equivalent, ready for tracePath.
 * traceShot includes cushion losses in this input. Null for straight paths.
 */
export function caromCurve(g: ShotGeometry, type: ShotType, powerTravel: number): CaromCurve | null {
  if (Math.sin(g.cut) < 0.03) return null;
  const u = caromUnit(g, type);
  if (!u || powerTravel <= 1e-6) return null;
  const L = powerTravel / (u.arc + u.roll);
  return { offsets: u.pts.map((p) => scale(p, L)), arc: u.arc * L };
}

export interface CaromLocus {
  dir: Vec;
  /** Straight-line distance covered per unit of path travel (≲ 1). */
  eta: number;
}

/**
 * Before cushions, landings at all energies lie on one ray from the ghost.
 * Folding this locus at rails approximates the landings. Cushion losses
 * change the slide length, so selected routes need exact validation.
 */
export function caromLocus(g: ShotGeometry, type: ShotType): CaromLocus | null {
  const dir = departureDir(g, type);
  if (!dir) return null;
  const u = Math.sin(g.cut) < 0.03 ? null : caromUnit(g, type);
  return u ? { dir: u.locusDir, eta: u.eta } : { dir, eta: 1 };
}

/** Post-contact path distance per inch of impact roll-out energy, without rails. */
function cueDistanceShare(g: ShotGeometry, type: ShotType): number {
  if (type === 'stop') return 0;
  const u = caromUnit(g, type);
  return u ? 2 * SLIDE_ROLL_RATIO * (u.arc + u.roll)
    : SLIDING_DISTANCE_SHARE * Math.sin(g.cut) ** 2;
}

export function minCueTravel(g: ShotGeometry, type: ShotType): number {
  return cueDistanceShare(g, type) * minimumHit(g);
}

function minimumHit(g: ShotGeometry): number {
  return g.dBallPocket * POCKET_PACE / (SLIDING_DISTANCE_SHARE * Math.cos(g.cut) ** 2);
}

/** Impact energy in equivalent rolling inches. cueTravel includes cushion losses. */
export function hitDistance(g: ShotGeometry, type: ShotType, cueTravel: number): number {
  if (type === 'stop') return minimumHit(g);
  return Math.max(minimumHit(g), cueTravel / Math.max(cueDistanceShare(g, type), 1e-12));
}

/** Unobstructed object-ball roll-out from the same impact energy as the cue route. */
export function objectTravel(g: ShotGeometry, type: ShotType, cueTravel: number): number {
  return hitDistance(g, type, cueTravel) * SLIDING_DISTANCE_SHARE * Math.cos(g.cut) ** 2;
}

export interface TraceResult {
  /** Polyline of the cue ball center, starting at the origin point. */
  points: Vec[];
  end: Vec;
  rails: number;
  outcome: 'ok' | 'ball' | 'scratch' | 'rail-limit' | 'invalid';
  /** Total distance actually travelled. */
  travelled: number;
}

function reflect(dir: Vec, wall: 'x' | 'y'): Vec {
  return wall === 'x' ? { x: -dir.x, y: dir.y } : { x: dir.x, y: -dir.y };
}

const LONG_RAIL_DIAMOND = TABLE_W / 8;
const SHORT_RAIL_DIAMOND = TABLE_H / 4;
/** Effective normal-speed retention. Calibrate for the actual cushions. */
export const CUSHION_RESTITUTION = 0.82;
/** Remaining modeled sidespin after each cushion contact. */
export const CUSHION_SPIN_RETENTION = 0.5;

/** Fraction of translational energy retained at this cushion contact. */
export function cushionRetention(dir: Vec, contact: Vec): number {
  const normal = Math.abs(contact.x - MIN_X) < 1e-6 || Math.abs(contact.x - MAX_X) < 1e-6
    ? dir.x : dir.y;
  return 1 - (1 - CUSHION_RESTITUTION ** 2) * normal ** 2;
}

/** Free-cloth travel needed for a path. initialDir also prices a rebound at its origin. */
export function pathPowerTravel(points: Vec[], initialDir: Vec): number {
  let power = 0;
  let retention = 1;
  for (let i = 1; i < points.length; i++) {
    const d = sub(points[i], points[i - 1]);
    const length = Math.hypot(d.x, d.y);
    power += length / retention;
    const p = points[i];
    const incoming = length > 1e-9 ? scale(d, 1 / length) : i === 1 ? norm(initialDir) : null;
    if (incoming && (Math.abs(p.x - MIN_X) < 1e-6 || Math.abs(p.x - MAX_X) < 1e-6 ||
      Math.abs(p.y - MIN_Y) < 1e-6 || Math.abs(p.y - MAX_Y) < 1e-6)) {
      retention *= cushionRetention(incoming, p);
    }
  }
  return power;
}

function rebound(dir: Vec, wall: 'x' | 'y', sidespin: number): Vec {
  const mirrored = reflect(dir, wall);
  if (sidespin === 0) return mirrored;
  // ponytail: calibrated rebound angle, use coupled cushion friction for measured spin response.
  const tangent = wall === 'x' ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const rightOfTravel = rotate(dir, -Math.PI / 2);
  const tangentPush = dot(rightOfTravel, tangent) * sidespin;
  const normalSpeed = Math.abs(wall === 'x' ? dir.x : dir.y);
  const crossTable = wall === 'x' ? MAX_X - MIN_X : MAX_Y - MIN_Y;
  const oneDiamond = wall === 'x' ? SHORT_RAIL_DIAMOND : LONG_RAIL_DIAMOND;
  const tangentShift = 2 * oneDiamond * tangentPush * normalSpeed;
  const towardTangent = Math.sign(cross(mirrored, tangent)) || 1;
  return norm(rotate(mirrored, towardTangent * Math.atan(tangentShift / crossTable)));
}

export interface TraceOptions {
  maxRails?: number;
  curve?: CaromCurve;
  sidespin?: Sidespin;
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
  options: TraceOptions = {},
): TraceResult {
  const { maxRails = 4, curve, sidespin = 0 } = options;
  let pos = { x: start.x, y: start.y };
  let dir = norm(dir0);
  // Slide-phase vertices still ahead (absolute); mirrored with dir on rebounds.
  let pending: Vec[] = curve ? curve.offsets.map((o) => add(start, o)) : [];
  let remaining = totalDist;
  let rails = 0;
  let spin = sidespin as number;
  const points: Vec[] = [{ x: pos.x, y: pos.y }];
  if (!onTable(start) || !Number.isFinite(totalDist) || totalDist < 0 ||
    !Number.isFinite(dir.x) || !Number.isFinite(dir.y) ||
    (totalDist > 0 && dot(dir, dir) < 0.5)) {
    return { points, end: pos, rails, outcome: 'invalid', travelled: 0 };
  }

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

    // A capture disk locates a cushion opening. Cloth inside the disk is
    // playable until the ball actually reaches that opening.
    let tPocket = Infinity;
    if (tWall <= horizon) {
      const contact = add(pos, scale(segDir, tWall));
      for (const p of POCKETS) {
        if (dot(segDir, p.facing) > 0 && dist(contact, p.captureCenter) <= p.captureRadius) {
          tPocket = tWall;
          break;
        }
      }
    }

    const tStop = Math.min(horizon, tBall, tPocket);
    pos = add(pos, scale(segDir, tStop));
    points.push({ x: pos.x, y: pos.y });
    remaining -= tStop;

    if (tPocket <= tStop + 1e-9 && tPocket <= tBall) {
      return { points, end: pos, rails, outcome: 'scratch', travelled: totalDist - remaining };
    }
    if (tBall <= tStop + 1e-9) {
      return { points, end: pos, rails, outcome: 'ball', travelled: totalDist - remaining };
    }
    if (remaining <= 1e-6) break;

    if (tWall <= tStop + 1e-9 && wall !== null) {
      // Rotate the remaining slide and roll together at the cushion.
      if (rails >= maxRails) {
        return { points, end: pos, rails, outcome: 'rail-limit', travelled: totalDist - remaining };
      }
      rails += 1;
      const w = wall;
      const wx = pos.x;
      const wy = pos.y;
      const mirrored = reflect(segDir, w);
      const bounced = rebound(segDir, w, spin);
      const turn = Math.atan2(cross(mirrored, bounced), dot(mirrored, bounced));
      pending = pending.map((p) => {
        const reflected = w === 'x' ? { x: 2 * wx - p.x, y: p.y } : { x: p.x, y: 2 * wy - p.y };
        return add(pos, rotate(sub(reflected, pos), turn));
      });
      dir = rotate(reflect(dir, w), turn);
      spin *= CUSHION_SPIN_RETENTION;
    } else if (pending.length > 0 && tStop >= segLen - 1e-9) {
      pending.shift(); // reached a slide vertex
    }
  }

  return { points, end: pos, rails, outcome: 'ok', travelled: totalDist };
}

/**
 * Trace a chosen geometric travel, accounting for the hit energy lost at rails.
 * More energy lengthens the initial slide, so resolve its scale with the path.
 * Unconverged paths are rejected. This remains a planar cushion approximation.
 */
export function traceShot(
  g: ShotGeometry, type: ShotType, travel: number, obstacles: Vec[],
  options: { maxRails?: number; sidespin?: Sidespin; directionError?: number } = {},
): TraceResult & { powerTravel: number; curve?: CaromCurve } {
  const error = options.directionError ?? 0;
  const dir = rotate(departureDir(g, type) ?? g.aim, error);
  let powerTravel = travel;
  for (let i = 0; ; i++) {
    const base = caromCurve(g, type, powerTravel);
    const curve = base ? {
      offsets: base.offsets.map(p => rotate(p, error)), arc: base.arc,
    } : undefined;
    const trace = tracePath(g.ghost, dir, travel, obstacles, { ...options, curve });
    const required = pathPowerTravel(trace.points, curve?.offsets[0] ?? dir);
    if (!base || trace.outcome !== 'ok' || Math.abs(required - powerTravel) < 0.01) {
      return { ...trace, powerTravel: required, curve };
    }
    if (i === 7) return { ...trace, outcome: 'invalid', powerTravel: required, curve };
    powerTravel = required;
  }
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
