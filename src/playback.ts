// Kinematic shot playback (issue #19, ADR-0006): maps animation time `t` to
// ball positions ALONG THE GEOMETRY THE SOLVER ALREADY TRACED. This is a replay,
// not a physics simulation — the balls never leave the cue-approach line, the
// object-ball-to-pocket line, or the traced carom `path` the diagram drew.
//
// Motion uses a single rolling-friction deceleration constant (`DECEL`). Each
// moving phase is launched at a start speed derived from an existing solver
// quantity — `hitDistance` (the hit's equivalent roll-out, for the approach),
// `travel` (the cue's post-contact carom, comes to rest at `landing`), and
// `POCKET_PACE` (the pace the object ball still carries as it drops). Durations
// therefore emerge from distance and hit power: a harder hit approaches faster,
// a longer route takes longer. "Real-time" is a look, not a measured quantity
// (ADR-0006) — `DECEL` is one tuned constant, reviewed by feel.

import { Vec, dist, scale, add, sub, dot } from './geometry';
import { shotGeometry, hitDistance, POCKET_PACE, pathPowerTravel, caromCurve, departureDir } from './shots';
import type { PlannedShot } from './solver';

/**
 * Rolling-friction deceleration, inches/second². A ball rolling distance `d`
 * to rest takes `sqrt(2d/DECEL)` seconds, so this sets the wall-clock feel: a
 * ~50-inch roll lands near 1.6 s, a full-table lag near 2.3 s. Tuned by human
 * review (the only acceptance test for "feels like a real shot"), not derived.
 */
const DECEL = 38;

/**
 * Minimum hit power (equivalent roll-out, inches) for the cue's approach speed.
 * Very short pots need little impact energy. This timing floor keeps the
 * cue approach from crawling on those shots.
 */
const HIT_FLOOR = 12;

export interface PlaybackState {
  /** Cue-ball center at this instant. */
  cue: Vec;
  /** Object-ball center, or null once it has dropped into the pocket. */
  object: Vec | null;
  /** True once the shot has fully played out (cue on landing, object potted). */
  done: boolean;
}

export interface ShotPlayback {
  /** Total wall-clock length of the shot, seconds. */
  duration: number;
  /** Ball positions at animation time `t` (seconds since the shot started). */
  at(t: number): PlaybackState;
}

/** Arc length along a polyline of the point closest to `target`. */
function nearestArc(poly: Vec[], target: Vec): number {
  let acc = 0;
  let best = Infinity;
  let bestArc = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const ab = sub(poly[i], a);
    const segLen = Math.hypot(ab.x, ab.y);
    if (segLen < 1e-9) continue;
    let t = dot(sub(target, a), ab) / (segLen * segLen);
    t = Math.max(0, Math.min(1, t));
    const proj = add(a, scale(ab, t));
    const d = dist(target, proj);
    if (d < best) {
      best = d;
      bestArc = acc + t * segLen;
    }
    acc += segLen;
  }
  return bestArc;
}

/** Point a given distance along a polyline (clamped to its endpoints). */
function pointAlong(poly: Vec[], d: number): Vec {
  if (poly.length === 0) return { x: 0, y: 0 };
  if (poly.length === 1 || d <= 0) return poly[0];
  let remaining = d;
  for (let i = 1; i < poly.length; i++) {
    const segLen = dist(poly[i - 1], poly[i]);
    if (remaining <= segLen || i === poly.length - 1) {
      const dir = segLen > 1e-9 ? scale(sub(poly[i], poly[i - 1]), 1 / segLen) : { x: 0, y: 0 };
      return add(poly[i - 1], scale(dir, Math.min(remaining, segLen)));
    }
    remaining -= segLen;
  }
  return poly[poly.length - 1];
}

/**
 * Distance a ball decelerating from `v0` has covered at time `t` (capped).
 * The kinematic `v0·t − ½·DECEL·t²` is only valid until the ball stops at
 * `t = v0/DECEL`; past that the parabola turns DOWN, which would walk the ball
 * back the way it came. So freeze time at the rest-instant: once stopped, the
 * ball holds its rest distance instead of reversing.
 */
function covered(v0: number, t: number, maxDist: number): number {
  const tStop = v0 / DECEL;
  const tc = Math.min(t, tStop);
  const d = v0 * tc - 0.5 * DECEL * tc * tc;
  return Math.max(0, Math.min(maxDist, d));
}

/** Time to roll exactly `d` inches starting at speed `v0` under DECEL. */
function timeToCover(v0: number, d: number): number {
  if (d <= 0) return 0;
  const disc = Math.max(0, v0 * v0 - 2 * DECEL * d);
  return (v0 - Math.sqrt(disc)) / DECEL;
}

/** Equivalent roll-out (inches) of the hit this shot demands — the approach speed source. */
function hitEquiv(shot: PlannedShot): number {
  if (!shot.type) return HIT_FLOOR;
  const g = shotGeometry(shot.cuePos, shot.ball.pos, shot.pocket);
  if (!g) return HIT_FLOOR;
  const initialDir = caromCurve(g, shot.type, 1)?.offsets[0] ?? departureDir(g, shot.type) ?? g.aim;
  const power = shot.path ? pathPowerTravel(shot.path, initialDir) : shot.travel;
  return Math.max(hitDistance(g, shot.type, power), HIT_FLOOR);
}

/**
 * Build the kinematic replay of one planned shot. Two phases:
 *   1. Approach — the cue rolls `cuePos → ghost`, still moving at contact (the
 *      hit power `hitEquiv` is energy it carries past the ghost).
 *   2. Concurrent, after contact — the object ball rolls `ball.pos → pocket`
 *      and drops as it arrives; the cue caroms along its traced `path` and
 *      comes to rest on `landing`.
 */
export function buildPlayback(shot: PlannedShot): ShotPlayback {
  const cuePos = shot.cuePos;
  const ghost = shot.ghost;
  const objStart = shot.ball.pos;
  const objEnd = shot.pocket.target;
  const caromPath = shot.path && shot.path.length >= 2 ? shot.path : null;
  // The cue rests on `landing` — the planned leave, which is exactly the NEXT
  // shot's cue position, so the freeze flows seamlessly into the next step's
  // diagram. The traced `path` can overshoot it: a stop shot's landing is the
  // ghost (cue "stays put") while its path runs ~0.5in past by minCueTravel.
  // So we walk the cue only as far as the path point nearest `landing` (zero
  // for a stop — it never creeps forward) and freeze there.
  const landing = shot.landing ?? (caromPath ? caromPath[caromPath.length - 1] : ghost);

  // Phase 1: approach. The cue decelerates toward a virtual rest at
  // (approach + hit power); it reaches the ghost still carrying the hit.
  const approachPoly = dist(cuePos, ghost) > 1e-6 ? [cuePos, ghost] : null;
  const LA = approachPoly ? dist(cuePos, ghost) : 0;
  const H = hitEquiv(shot);
  const v0Approach = Math.sqrt(2 * DECEL * (LA + H));
  const vContact = Math.sqrt(2 * DECEL * H);
  const TA = approachPoly ? (v0Approach - vContact) / DECEL : 0;

  // Phase 2a: cue carom. The cue walks the traced path up to the point nearest
  // `landing` (LC), coming to rest there. Clamping to `landing` rather than the
  // raw path end keeps a stop shot put and avoids overshoot/snap-back.
  const LC = caromPath ? nearestArc(caromPath, landing) : 0;
  const v0Carom = Math.sqrt(2 * DECEL * LC);
  const TC = LC > 1e-6 ? Math.sqrt((2 * LC) / DECEL) : 0;

  // Phase 2b: object ball to pocket. Its launch speed is set by the HIT, split
  // by the cut angle — the 90-degree rule (Alciatore, "The Amazing World of
  // Billiards Physics"): at impact the object ball takes the component of the
  // cue's velocity ALONG the impact line, `vContact·cos(cut)`, and the cue
  // keeps the tangent component. So a fuller hit (small cut) sends the object
  // ball off near full speed while the cue stays slow — which is exactly why a
  // near-straight follow does NOT let the caroming cue overtake the ball it
  // just potted. The speed is the HIT split by angle, NOT a function of how far
  // the pocket is. We floor it at the pace that still reaches the pocket (the
  // old distance-derived speed, with a POCKET_PACE carry past the lip so it is
  // visibly still rolling as it drops) so a thin, soft cut never stalls short.
  const objPoly = [objStart, objEnd];
  const LO = dist(objStart, objEnd);
  const cut = (shot.cutDeg * Math.PI) / 180;
  const v0ObjFloor = Math.sqrt(2 * DECEL * (LO * POCKET_PACE));
  const v0Obj = Math.max(vContact * Math.cos(cut), v0ObjFloor);
  const TO = timeToCover(v0Obj, LO);

  const postDuration = Math.max(TC, TO);
  const duration = TA + postDuration;

  function at(t: number): PlaybackState {
    if (t <= 0) return { cue: cuePos, object: objStart, done: false };
    if (t >= duration) return { cue: landing, object: null, done: true };

    if (t < TA && approachPoly) {
      return { cue: pointAlong(approachPoly, covered(v0Approach, t, LA)), object: objStart, done: false };
    }

    const tp = t - TA;
    const cue = caromPath ? pointAlong(caromPath, covered(v0Carom, tp, LC)) : landing;
    const object = tp >= TO ? null : pointAlong(objPoly, covered(v0Obj, tp, LO));
    return { cue, object, done: false };
  }

  return { duration, at };
}
