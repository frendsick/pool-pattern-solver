// Position Zone (see CONTEXT.md): the region of cue-ball positions from which
// the next ball goes to its chosen pocket AND the cue ball can still be moved
// on toward the following ball's zone. The solver uses the continuous value
// `zoneValue` (0 when infeasible); the polygon builder is for rendering only.

import { Vec, add, sub, scale, norm, rotate, dist } from './geometry';
import { BALL_R, TABLE_W, TABLE_H, MIN_X, MAX_X, MIN_Y, MAX_Y, Pocket, onTable } from './table';
import {
  ShotGeometry,
  ShotType,
  shotGeometry,
  minCueTravel,
  hitDistance,
  tracePath,
  caromLocus,
  cuePathClear,
  ballPathToPocketClear,
} from './shots';
import {
  SkillProfile,
  DIST_NODES,
  DIST_WEIGHTS,
  distanceSigma,
  drawRailFactor,
  potProbability,
  powerFactor,
  railRouteFactor,
  routeReliability,
} from './skill';

/**
 * Within ~13 cm of a cushion, cueing AWAY from that cushion (toward the table
 * center) is awkward — the bridge hand ends up on the rail. Shooting along
 * the near rail, or into it, is unaffected however close the cue ball sits.
 * Awkward spots are soft-penalized in `zoneValue` (so the solver leaves the
 * cue ball there only when it has to) and hard-excluded from the drawn
 * polygon unless nothing else is left.
 */
export const RAIL_MARGIN = 5;

/** Cueing toward center more than ~20° off rail-parallel counts as awkward. */
export const RAIL_AWAY_GATE = 0.35;

/** Gate target for onward control: value of a cue position for what FOLLOWS. */
export type NextValueFn = (p: Vec) => number;

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
  /**
   * Full-depth alternative to `next` (see value.ts): the following ball's
   * backward value surface, normalized to its own peak. When set, onward
   * control measures exit landings against it instead of `next`, so the gate
   * carries the whole chain of requirements down to the 9 — not one ball of
   * lookahead. CONTROL_SAT then reads "reach a spot worth >= 60% of the best
   * still available for the rest of the rack".
   */
  nextValue?: NextValueFn;
  /** Lazy memo for onwardControl, see cachedOnwardControl. */
  controlMemo?: Map<number, number>;
}

export function zoneContext(
  ball: Vec,
  pocket: Pocket,
  obstacles: Vec[],
  next: ZoneContext[] = [],
  nextValue?: NextValueFn,
): ZoneContext {
  return {
    ball,
    pocket,
    obstacles,
    ballPathClear: ballPathToPocketClear(ball, pocket, obstacles),
    next,
    nextValue,
  };
}

export function railDist(c: Vec): number {
  return Math.min(c.x - MIN_X, MAX_X - c.x, c.y - MIN_Y, MAX_Y - c.y);
}

/**
 * Worst component of the shot direction pointing away from a rail within
 * `margin` of the cue ball, 0..1. Zero means every near rail is being cued
 * along or into — comfortable no matter how close the cushion is.
 */
export function railAway(c: Vec, cueDir: Vec, margin = RAIL_MARGIN): number {
  let worst = 0;
  if (c.x - MIN_X < margin) worst = Math.max(worst, cueDir.x);
  if (MAX_X - c.x < margin) worst = Math.max(worst, -cueDir.x);
  if (c.y - MIN_Y < margin) worst = Math.max(worst, cueDir.y);
  if (MAX_Y - c.y < margin) worst = Math.max(worst, -cueDir.y);
  return Math.max(0, worst);
}

/** The hard rail-band exclusion: in the band AND cueing toward center. */
export function railExcluded(c: Vec, cueDir: Vec, margin = RAIL_MARGIN): boolean {
  return railDist(c) < margin && railAway(c, cueDir, margin) > RAIL_AWAY_GATE;
}

/** Ghost-ball position of the zone's shot (cue-ball center at contact). */
export function zoneGhost(z: ZoneContext): Vec {
  const aim = norm(sub(z.pocket.target, z.ball));
  return sub(z.ball, scale(aim, 2 * BALL_R));
}

function railComfort(c: Vec, cueDir: Vec): number {
  const d = railDist(c);
  if (d >= RAIL_MARGIN) return 1;
  return 1 - (0.45 * railAway(c, cueDir) * (RAIL_MARGIN - d)) / RAIL_MARGIN;
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

/**
 * Closeness preference (position play): leaving the cue ball the length of the
 * table from the next ball is worse position than getting to it, even when the
 * pot stays makeable from distance. Pot probability saturates for easy balls
 * (erf flattens near 1), so without this factor the solver is indifferent
 * between a mid-table leave and the full length of the table — and it happily
 * leaves a dead-straight, full-table leave because the pot reads the same. A
 * real player gets close: short shots compound margin and, crucially, keep
 * cue-ball options open for the rest of the rack.
 *
 * The penalty lives ENTIRELY past half the long rail. Inside half-table every
 * leave is full value, so the routine comfortable-range decisions — the
 * "stay-in-window" and "keep-it-simple" calibrations (rounds 21-23) — are
 * untouched; the factor only bites when there is "a lot of room", i.e. the
 * next ball is more than half a table away and the player could have gotten
 * closer. Beyond the knee it falls progressively (accelerating with distance)
 * to POSITION_FLOOR at the far diagonal.
 *
 * It rides on `zoneValue`, so it shapes the drawn windows, the backward value
 * surfaces, and every onward-control reading alike: a leave whose only cheap
 * onward route stays full-table from the next ball loses the credit a
 * closer-reaching, angled leave keeps.
 */
const POSITION_HALF = TABLE_W / 2; // 50": the "over half-table" knee
const POSITION_DIAG = Math.hypot(TABLE_W, TABLE_H); // ~112"
const POSITION_FLOOR = 0.5;

export function proximity(d: number): number {
  if (d <= POSITION_HALF) return 1;
  const t = Math.min(1, (d - POSITION_HALF) / (POSITION_DIAG - POSITION_HALF));
  // Convex (t^1.5): a gentle nudge just past half-table, steepening into a
  // real penalty for a true full-table leave.
  return 1 - (1 - POSITION_FLOOR) * Math.pow(t, 1.5);
}

// Onward control: reaching a spot worth >= CONTROL_SAT on the next ball earns
// full credit; weaker reachability scales the zone value down proportionally.
const CONTROL_SAT = 0.6;
const CONTROL_STEP = 5;
const CONTROL_RANGE = 120;
const STRAIGHT_CUT = (9 * Math.PI) / 180;

function bestNextValue(p: Vec, z: ZoneContext, skill: SkillProfile): number {
  if (z.nextValue) return z.nextValue(p);
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
 * the toughest). Travel chosen beyond the forced minimum mostly remains the
 * Route's problem, but the gate does price hit power (powerFactor) and rigid
 * near-straight multi-rail follow (railRouteFactor). Straight-ish follow can
 * be powered through top spin, but near-straight sideways stun/draw exits
 * still need a monster stroke, so they stop counting. A near-straight shot
 * mostly offers the aim line itself, which is exactly why straight position
 * is rigid.
 */
function onwardControl(g: ShotGeometry, z: ZoneContext, skill: SkillProfile): number {
  const sat = (v: number) => Math.min(1, v / CONTROL_SAT);
  let best = 0;
  if (g.cut < STRAIGHT_CUT) {
    // The stop exit drifts along the aim line with cue-to-ball distance
    // (stopDrift) — same kill-drift the routes price: average the next value
    // over the drift spread, with forward creep into the mouth a scratch.
    const sig = distanceSigma('stop', 0.5, 0, skill, g.dCueGhost);
    let v = 0;
    for (let i = 0; i < DIST_NODES.length; i++) {
      const p = add(g.ghost, scale(g.aim, DIST_NODES[i] * sig));
      const scratched = dist(p, z.pocket.target) < z.pocket.captureRadius;
      v += DIST_WEIGHTS[i] * (scratched ? 0 : bestNextValue(p, z, skill));
    }
    best = sat(v) * skill.typeReliability.stop;
  }
  for (const type of ['follow', 'stun', 'lowTouch', 'draw'] as ShotType[]) {
    // Exit landings walked along the landing locus (caromLocus): the carom
    // path's tangent-line slide scales with travel, so every travel's landing
    // sits on this one ray off the ghost.
    const locus = caromLocus(g, type);
    if (!locus) continue;
    const minTravel = minCueTravel(g, type);
    const cap =
      Math.exp(-minTravel / skill.positionTravelScale) *
      routeReliability(type, g.dCueGhost, skill);
    if (cap <= best) continue; // cannot beat what another exit already offers
    const tr = tracePath(g.ghost, locus.dir, CONTROL_RANGE * locus.eta, z.obstacles, 3);
    // Draw action is compromised when the first cushion arrives early: the
    // post-rail part of the exit line is discounted (drawRailFactor).
    const firstSeg = tr.points.length > 2 ? dist(tr.points[0], tr.points[1]) : null;
    let s = 0; // cumulative travel at the start of the segment
    outer: for (let i = 0; i + 1 < tr.points.length; i++) {
      const a = tr.points[i];
      const b = tr.points[i + 1];
      const segLen = dist(a, b);
      if (segLen < 1e-9) continue;
      const d = norm(sub(b, a));
      const railFac = i === 0 ? 1 : drawRailFactor(type, firstSeg, skill);
      const railRoute = railRouteFactor(type, g.cut, i, skill);
      for (let t = CONTROL_STEP; t <= segLen; t += CONTROL_STEP) {
        const travel = (s + t) / locus.eta;
        if (travel < minTravel) continue;
        const pf = powerFactor(hitDistance(g, type, travel), skill);
        if (pf <= 0) break outer; // farther only needs more power
        const v =
          sat(bestNextValue(add(a, scale(d, t)), z, skill)) *
          cap * pf * railFac * railRoute;
        if (v > best) best = v;
        if (best >= cap - 1e-9) break outer; // this exit is saturated
      }
      s += segLen;
    }
  }
  return best;
}

/**
 * onwardControl depends on the cue position only through the cut angle, its
 * side of the aim line, and (for draw reliability) the cue-to-ghost distance:
 * every exit line is traced from the fixed ghost ball. Quantizing those
 * (0.5° cuts, 4″ distances) and memoizing per context makes onward-gated
 * zoneValue cheap enough for the route search to use the same gated zones
 * the renderer draws.
 */
function cachedOnwardControl(g: ShotGeometry, z: ZoneContext, skill: SkillProfile): number {
  const side = g.aim.x * g.cueDir.y - g.aim.y * g.cueDir.x >= 0 ? 1 : 0;
  const cutB = Math.round(g.cut * (360 / Math.PI));
  const distB = Math.min(63, Math.round(g.dCueGhost / 4));
  const key = side * 65536 + cutB * 64 + distB;
  const memo = (z.controlMemo ??= new Map());
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const v = onwardControl(g, z, skill);
  memo.set(key, v);
  return v;
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
  let v = pot * railComfort(c, g.cueDir) * ballComfort(dBall) * obstComfort * proximity(dBall);
  if (z.next.length > 0 || z.nextValue) v *= cachedOnwardControl(g, z, skill);
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

/**
 * The value a position must reach to count as inside the window: within
 * ZONE_RELATIVE of the zone's best (raised to `reference` for second-choice
 * zones). `cap` lowers the anchor to what the arriving route can actually
 * reach (PlannedShot.windowRef): the drawn window then shows the stretch
 * that route is playing for, and the planned landing sits inside it.
 */
export function zoneBar(
  z: ZoneContext,
  skill: SkillProfile,
  reference = 0,
  cap = Infinity,
): number {
  const anchor = Math.min(cap, Math.max(zonePeak(z, skill), reference));
  return Math.max(ZONE_FLOOR, ZONE_RELATIVE * anchor);
}

/**
 * Build drawable pie-shaped polygons for the zone: rays fanned around the
 * "straight in" direction (opposite the aim line), each clipped to its first
 * good run. A ray with no good point at all (e.g. the whole direction sits in
 * another ball's shadow) splits the pie — the window must not bridge across a
 * wedge it cannot actually use, so each contiguous run of good rays becomes
 * its own polygon. Rail-band positions that would cue away from the near rail
 * are excluded (railExcluded — along-the-rail shots keep them); if that
 * leaves nothing, the awkward band is reluctantly readmitted.
 */
export function zonePolygons(
  z: ZoneContext,
  skill: SkillProfile,
  reference = 0,
  // A touch beyond zonePeak's scan: route landings can sit out here, and the
  // drawn window must not clip them on the radius alone.
  maxRadius = 85,
  cap = Infinity,
): Vec[][] {
  if (!z.ballPathClear) return [];
  const minValue = zoneBar(z, skill, reference, cap);
  return (
    buildPies(z, skill, minValue, maxRadius, true) ??
    buildPies(z, skill, minValue, maxRadius, false) ??
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

function buildPies(
  z: ZoneContext,
  skill: SkillProfile,
  minValue: number,
  maxRadius: number,
  excludeRailBand: boolean,
): Vec[][] | null {
  const aimBack = rayDir(z); // direction away from pocket
  const halfFan = Math.min(skill.maxCut, (78 * Math.PI) / 180);
  // Finer than the scanFan grid: the outline must not clip a corner the
  // route search just placed a landing in (cachedOnwardControl keeps this cheap).
  const steps = 72;
  const inner = 2 * BALL_R + 0.3;
  const ghost = zoneGhost(z);

  // A ray can hold SEVERAL in-bar runs — e.g. a rich stretch pinched in the
  // middle by another ball's clearance ring (image #29 fallout, seed 63).
  // Each run extends the lobe whose run on the previous ray it radially
  // overlaps; runs that bridge nothing start a new lobe, lobes nothing
  // extends are flushed. The dip itself stays out of every lobe, so the
  // window still never bridges a dead stretch.
  interface Lobe {
    outer: Vec[];
    inner: Vec[];
    last: [number, number];
  }
  const pies: Vec[][] = [];
  let lobes: Lobe[] = [];
  const flush = (l: Lobe) => {
    if (l.outer.length >= 2) pies.push([...l.outer, ...l.inner.reverse()]);
  };
  for (let i = 0; i <= steps; i++) {
    const phi = -halfFan + (2 * halfFan * i) / steps;
    const dir = rotate(aimBack, phi);
    const runs: [number, number][] = [];
    let start: number | null = null;
    let prev = 0;
    for (let r = inner; r <= maxRadius; r += 0.75) {
      const p = add(z.ball, scale(dir, r));
      const good =
        (!excludeRailBand || !railExcluded(p, norm(sub(ghost, p)))) &&
        zoneValue(p, z, skill) >= minValue;
      if (good) {
        if (start === null) start = r;
        prev = r;
      } else if (start !== null) {
        runs.push([start, prev]);
        start = null;
      }
    }
    if (start !== null) runs.push([start, prev]);

    const kept: Lobe[] = [];
    const used = new Set<number>();
    for (const l of lobes) {
      const j = runs.findIndex(
        (run, idx) => !used.has(idx) && run[0] <= l.last[1] && run[1] >= l.last[0],
      );
      if (j >= 0) {
        used.add(j);
        l.outer.push(add(z.ball, scale(dir, runs[j][1])));
        l.inner.push(add(z.ball, scale(dir, runs[j][0])));
        l.last = runs[j];
        kept.push(l);
      } else {
        flush(l); // dead direction for this lobe: no bridging across it
      }
    }
    runs.forEach((run, idx) => {
      if (used.has(idx)) return;
      kept.push({
        outer: [add(z.ball, scale(dir, run[1]))],
        inner: [add(z.ball, scale(dir, run[0]))],
        last: run,
      });
    });
    lobes = kept;
  }
  for (const l of lobes) flush(l);
  return pies.length > 0 ? pies : null;
}

function rayDir(z: ZoneContext): Vec {
  const dx = z.ball.x - z.pocket.target.x;
  const dy = z.ball.y - z.pocket.target.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}
