// Position Zone (see CONTEXT.md): the region of cue-ball positions from which
// the next ball goes to its chosen pocket AND the cue ball can still be moved
// on toward the following ball's zone. The solver uses the continuous value
// `zoneValue` (0 when infeasible); the polygon builder is for rendering only.

import { Vec, add, sub, scale, norm, rotate, dist } from './geometry';
import { BALL_R, MIN_X, MAX_X, MIN_Y, MAX_Y, Pocket, onTable } from './table';
import {
  ShotGeometry,
  ShotType,
  shotGeometry,
  departureDir,
  minCueTravel,
  tracePath,
  cuePathClear,
  ballPathToPocketClear,
} from './shots';
import { SkillProfile, potProbability, routeReliability } from './skill';

/**
 * Cueing within ~13 cm of a cushion is awkward: soft-penalized in `zoneValue`
 * (so the solver leaves the cue ball there only when it has to) and
 * hard-excluded from the drawn polygon unless nothing else is left.
 */
export const RAIL_MARGIN = 5;

export interface ZoneContext {
  ball: Vec;
  pocket: Pocket;
  /** Other balls on the table at the moment of that shot. */
  obstacles: Vec[];
  /** Precomputed: object ball -> pocket line is clear. */
  ballPathClear: boolean;
  /**
   * Zones of the FOLLOWING ball, one per open pocket. When non-empty, the
   * zone keeps only cue positions from which the cue ball can be sent into
   * one of them after the pot (onward control).
   */
  next: ZoneContext[];
}

export function zoneContext(
  ball: Vec,
  pocket: Pocket,
  obstacles: Vec[],
  next: ZoneContext[] = [],
): ZoneContext {
  return {
    ball,
    pocket,
    obstacles,
    ballPathClear: ballPathToPocketClear(ball, pocket, obstacles),
    next,
  };
}

function railDist(c: Vec): number {
  return Math.min(c.x - MIN_X, MAX_X - c.x, c.y - MIN_Y, MAX_Y - c.y);
}

function railComfort(c: Vec): number {
  const d = railDist(c);
  return d >= RAIL_MARGIN ? 1 : 0.55 + 0.45 * (d / RAIL_MARGIN);
}

/**
 * Finishing too close to the object ball cramps the next shot (no room to
 * cue, no angle left): infeasible inside BALL_MARGIN_HARD, full value from
 * BALL_MARGIN (~25 cm) out.
 */
const BALL_MARGIN_HARD = 4;
const BALL_MARGIN = 10;

function ballComfort(d: number): number {
  if (d < BALL_MARGIN_HARD) return 0;
  if (d >= BALL_MARGIN) return 1;
  return 0.3 + (0.7 * (d - BALL_MARGIN_HARD)) / (BALL_MARGIN - BALL_MARGIN_HARD);
}

/** Milder version for other balls: bridging next to one is awkward. */
function obstacleComfort(d: number): number {
  if (d >= 6) return 1;
  return 0.5 + (0.5 * (d - 2 * BALL_R)) / (6 - 2 * BALL_R);
}

// Onward control: reaching a spot worth >= CONTROL_SAT on the next ball earns
// full credit; weaker reachability scales the zone value down proportionally.
const CONTROL_SAT = 0.6;
const CONTROL_STEP = 5;
const CONTROL_RANGE = 120;
const STRAIGHT_CUT = (9 * Math.PI) / 180;

function bestNextValue(p: Vec, z: ZoneContext, skill: SkillProfile): number {
  let best = 0;
  for (const nz of z.next) {
    const v = zoneValue(p, nz, skill);
    if (v > best) best = v;
  }
  return best;
}

/**
 * How well the cue ball can be moved from this shot into the next ball's
 * zone: the best next-zone value reachable along the stop / follow / stun /
 * touch-of-low / draw departure lines off the ghost ball. Each exit type is
 * discounted by (a) the travel the pot FORCES on the cue ball at this cut
 * (pocket pace, minCueTravel — a thin cut makes the cue ball run whether you
 * like it or not) and (b) the type's execution reliability (draw is always
 * the toughest). Travel chosen beyond the forced minimum costs nothing here —
 * the window stays long along the shot line and natural multi-rail routes
 * count fully; executing the chosen distance is the Route's problem. A
 * near-straight shot only offers the aim line itself, which is exactly why
 * straight position is rigid.
 */
function onwardControl(g: ShotGeometry, z: ZoneContext, skill: SkillProfile): number {
  const sat = (v: number) => Math.min(1, v / CONTROL_SAT);
  let best =
    g.cut < STRAIGHT_CUT
      ? sat(bestNextValue(g.ghost, z, skill)) * skill.typeReliability.stop
      : 0;
  for (const type of ['follow', 'stun', 'lowTouch', 'draw'] as ShotType[]) {
    const dir = departureDir(g, type);
    if (!dir) continue;
    const minTravel = minCueTravel(g, type);
    const cap =
      Math.exp(-minTravel / skill.positionTravelScale) *
      routeReliability(type, g.dCueGhost, skill);
    if (cap <= best) continue; // cannot beat what another exit already offers
    const tr = tracePath(g.ghost, dir, CONTROL_RANGE, z.obstacles, 3);
    let s = 0; // cumulative travel at the start of the segment
    outer: for (let i = 0; i + 1 < tr.points.length; i++) {
      const a = tr.points[i];
      const b = tr.points[i + 1];
      const segLen = dist(a, b);
      if (segLen < 1e-9) continue;
      const d = norm(sub(b, a));
      for (let t = CONTROL_STEP; t <= segLen; t += CONTROL_STEP) {
        const travel = s + t;
        if (travel < minTravel) continue;
        const v = sat(bestNextValue(add(a, scale(d, t)), z, skill)) * cap;
        if (v > best) best = v;
        if (best >= cap - 1e-9) break outer; // this exit is saturated
      }
      s += segLen;
    }
  }
  return best;
}

/**
 * Value of having the cue ball at `c` for the zone's shot: pot probability,
 * discounted near rails and by lack of onward control; 0 when the position
 * is infeasible (off table, overlapping, blocked, cut too thin).
 */
export function zoneValue(c: Vec, z: ZoneContext, skill: SkillProfile): number {
  if (!z.ballPathClear) return 0;
  if (!onTable(c)) return 0;
  const dBall = dist(c, z.ball);
  if (ballComfort(dBall) <= 0) return 0;
  let obstComfort = 1;
  for (const o of z.obstacles) {
    const d = dist(c, o);
    if (d < 2 * BALL_R + 0.05) return 0;
    obstComfort = Math.min(obstComfort, obstacleComfort(d));
  }
  const g = shotGeometry(c, z.ball, z.pocket);
  if (!g) return 0;
  if (g.cut >= skill.maxCut) return 0;
  // The cue ball must sit on the shooting side of the object ball
  // (behind the ghost ball), otherwise there is no shot.
  if (g.dCueGhost < 0.5) return 0;
  if (!cuePathClear(c, g.ghost, z.obstacles)) return 0;
  const pot = potProbability(g, z.pocket, skill);
  if (pot <= 0) return 0;
  let v = pot * railComfort(c) * ballComfort(dBall) * obstComfort;
  if (z.next.length > 0) v *= onwardControl(g, z, skill);
  return v;
}

/**
 * The drawn window is where you'd be HAPPY, not everywhere the shot merely
 * exists: a ray point counts only when its value is within ZONE_RELATIVE of
 * the best position the zone offers (or of `reference`, when the zone is a
 * second-choice expansion judged against the primary pocket's best).
 */
export const ZONE_RELATIVE = 0.8;
export const ZONE_FLOOR = 0.12;

/** Best zoneValue over the scanned fan — the quality bar for the window. */
export function zonePeak(z: ZoneContext, skill: SkillProfile, maxRadius = 70): number {
  if (!z.ballPathClear) return 0;
  let peak = 0;
  scanFan(z, skill, maxRadius, (v) => {
    if (v > peak) peak = v;
  });
  return peak;
}

/** The value a position must reach to count as inside the window. */
export function zoneBar(z: ZoneContext, skill: SkillProfile, reference = 0): number {
  return Math.max(ZONE_FLOOR, ZONE_RELATIVE * Math.max(zonePeak(z, skill), reference));
}

/**
 * Build a drawable pie-shaped polygon for the zone: rays fanned around the
 * "straight in" direction (opposite the aim line), each clipped to its first
 * good run. The 20 cm rail band is excluded; if that leaves nothing (the
 * zone only exists against a rail), the band is reluctantly readmitted.
 */
export function zonePolygon(
  z: ZoneContext,
  skill: SkillProfile,
  reference = 0,
  maxRadius = 70,
): Vec[] {
  if (!z.ballPathClear) return [];
  const minValue = zoneBar(z, skill, reference);
  return (
    buildPie(z, skill, minValue, maxRadius, true) ??
    buildPie(z, skill, minValue, maxRadius, false) ??
    []
  );
}

function scanFan(
  z: ZoneContext,
  skill: SkillProfile,
  maxRadius: number,
  visit: (v: number) => void,
): void {
  const aimBack = rayDir(z); // direction away from pocket
  const halfFan = Math.min(skill.maxCut, (78 * Math.PI) / 180);
  const steps = 36;
  const inner = 2 * BALL_R + 0.3;
  for (let i = 0; i <= steps; i++) {
    const dir = rotate(aimBack, -halfFan + (2 * halfFan * i) / steps);
    for (let r = inner; r <= maxRadius; r += 1.5) {
      visit(zoneValue(add(z.ball, scale(dir, r)), z, skill));
    }
  }
}

function buildPie(
  z: ZoneContext,
  skill: SkillProfile,
  minValue: number,
  maxRadius: number,
  excludeRailBand: boolean,
): Vec[] | null {
  const aimBack = rayDir(z); // direction away from pocket
  const halfFan = Math.min(skill.maxCut, (78 * Math.PI) / 180);
  const steps = 36;
  const inner = 2 * BALL_R + 0.3;

  const outerArc: Vec[] = [];
  const innerArc: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const phi = -halfFan + (2 * halfFan * i) / steps;
    const dir = rotate(aimBack, phi);
    let firstGood: number | null = null;
    let lastGood: number | null = null;
    for (let r = inner; r <= maxRadius; r += 1.5) {
      const p = add(z.ball, scale(dir, r));
      if (excludeRailBand && railDist(p) < RAIL_MARGIN) {
        if (lastGood !== null) break;
        continue;
      }
      if (zoneValue(p, z, skill) >= minValue) {
        if (firstGood === null) firstGood = r;
        lastGood = r;
      } else if (lastGood !== null) {
        break; // stop the ray at the first blocked point past a good run
      }
    }
    if (firstGood !== null && lastGood !== null) {
      outerArc.push(add(z.ball, scale(dir, lastGood)));
      innerArc.push(add(z.ball, scale(dir, firstGood)));
    }
  }
  if (outerArc.length < 2) return null;
  return [...outerArc, ...innerArc.reverse()];
}

function rayDir(z: ZoneContext): Vec {
  const dx = z.ball.x - z.pocket.target.x;
  const dy = z.ball.y - z.pocket.target.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}
