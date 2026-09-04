// Position Zone (see CONTEXT.md): the region of cue-ball positions from which
// the next ball goes to its chosen pocket AND the cue ball can still be moved
// on toward the following ball's zone. The solver uses the continuous value
// `zoneValue` (0 when infeasible); the polygon builder is for rendering only.

import { Vec, add, sub, scale, norm, rotate, dist, cross, segmentClearsCircle } from './geometry';
import { BALL_R, CUE_OBSTACLE_CLEARANCE, TABLE_W, TABLE_H, MIN_X, MAX_X, MIN_Y, MAX_Y, Pocket, onTable } from './table';
import {
  ShotGeometry,
  ShotType,
  shotGeometry,
  minCueTravel,
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
  potProbability,
  routeReliability,
  walkExit,
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
 * Route's problem, but the gate does price hit power and rigid near-straight
 * multi-rail follow (both via routeEase). Straight-ish follow can
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
    // cap is the exit's ceiling: the pot-forced minimum travel discounted by
    // positionTravelScale, times the type's reliability. routeEase carries the
    // per-step rail-room, rail-route and hit-power price (draw rail-room is why
    // an early first cushion is discounted); forced = cap without reliability,
    // since routeEase already multiplies reliability back in.
    const forced = Math.exp(-minTravel / skill.positionTravelScale);
    const cap = forced * routeReliability(type, g.dCueGhost, skill);
    if (cap <= best) continue; // cannot beat what another exit already offers
    const tr = tracePath(g.ghost, locus.dir, CONTROL_RANGE * locus.eta, z.obstacles, {
      maxRails: 3,
    });
    const firstSeg = tr.points.length > 2 ? dist(tr.points[0], tr.points[1]) : null;
    let priced = false; // have we passed the pot-forced minimum travel yet?
    for (const st of walkExit(
      tr.points, locus.eta, firstSeg, g, type, 0, skill, CONTROL_STEP, false,
    )) {
      if (st.ease <= 0) {
        if (priced) break; // power exhausted; farther only needs more
        continue; // still below the pot-forced minimum travel
      }
      priced = true;
      const v = sat(bestNextValue(st.point, z, skill)) * forced * st.ease;
      if (v > best) best = v;
      if (best >= cap - 1e-9) break; // this exit is saturated
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
  const side = cross(g.aim, g.cueDir) >= 0 ? 1 : 0;
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
    if (d < CUE_OBSTACLE_CLEARANCE) return 0;
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
 * Build the drawable position-window polygon for the next ball (see
 * buildWindows for the construction). In short: take the in-bar good region,
 * fill the still-playable gaps bracketed by good on both sides (so a stripey
 * fan becomes one uniform window), but neither paint a dead spot nor reach out
 * into a thin mishit sliver, and draw only the one region the route plays for.
 * Rail-band positions cueing away from the near rail are excluded first; if
 * that leaves nothing the band is reluctantly readmitted.
 */
export function zonePolygons(
  z: ZoneContext,
  skill: SkillProfile,
  reference = 0,
  // A touch beyond zonePeak's scan: route landings can sit out here, and the
  // drawn window must not clip them on the radius alone.
  maxRadius = 85,
  cap = Infinity,
  landing?: Vec,
): Vec[][] {
  if (!z.ballPathClear) return [];
  const minValue = zoneBar(z, skill, reference, cap);
  return (
    buildWindows(z, skill, minValue, maxRadius, true, landing) ??
    buildWindows(z, skill, minValue, maxRadius, false, landing) ??
    []
  );
}

function scanFan(
  z: ZoneContext,
  skill: SkillProfile,
  maxRadius: number,
  visit: (v: number) => void,
): void {
  const aimBack = norm(sub(z.ball, z.pocket.target)); // direction away from pocket
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

// Fan resolution. Finer than scanFan's grid: the outline must not clip a
// corner the route search just placed a landing in (cachedOnwardControl keeps
// this cheap).
const FAN_STEPS = 72;
const FAN_DR = 0.75;
// Morphological closing may bridge a shallow below-bar dip so a stripey but
// effectively uniform fan draws as one window. Deeper weak dips are not
// uniform enough for drag-clamping, so they break the drawn polygon.
const BRIDGE_RELATIVE = 0.75;

// Window wedges thinner than this many rays (~1.7°/ray) are dissolved by the
// angular opening — a sliver that narrow is a mishit line, not a real leave.
const OPEN_RAYS = 4;

// The opening spares everything within this radius (inches) of the route's
// landing — the spot it plays for stays in the window even near an eroded edge.
const LANDING_KEEP = 7;

// Fan-cell classes.
const DEAD = 0; // off table, blocked, too thin a cut, or an awkward rail band
const FEAS = 1; // playable (pottable with onward control) but below the bar
const CORE = 2; // in-bar — a spot you'd be happy with

interface Lobe {
  outer: Vec[];
  inner: Vec[];
  last: [number, number]; // radial-cell span of the run on the previous ray
  cells: number; // window cells absorbed, a drawn-area proxy
  played: boolean; // holds the cell the route's landing falls in
}

/**
 * Builds the window mask, then stitches and selects it. The mask starts as the
 * morphological CLOSING of the in-bar (CORE) region within the playable area:
 *
 * Each fan cell is classed CORE, FEAS (playable but below the bar), or DEAD.
 * A feasible cell joins the mask when it is BRACKETED by core — between two
 * core cells along a ray (no dead cell between) OR between two core cells at
 * one radius across the fan. A below-bar STRIPE between two good lobes is
 * bracketed, so the lobes merge into one uniform window across it (stop there
 * and recover with draw, follow, or a rail). A DEAD gap is never bridged or
 * painted, so a ball cutting clean across leaves its far side separate. Then an
 * angular OPENING dissolves window wedges thinner than OPEN_RAYS — the thin
 * radial slivers reaching outward that the closing's cross-fan bracket would
 * otherwise leave, which are mishit lines, not leaves — while a disk around the
 * landing is spared (the route's own target is always a real leave).
 *
 * The mask is stitched into lobes (faithful — runs break at every non-mask
 * cell) and exactly one is drawn: the lobe holding `landing` (the run the route
 * plays for), else the largest. The far side of a dead barrier, the dissolved
 * slivers, and any stray island all fall away.
 */
function buildWindows(
  z: ZoneContext,
  skill: SkillProfile,
  minValue: number,
  maxRadius: number,
  excludeRailBand: boolean,
  landing?: Vec,
): Vec[][] | null {
  const aimBack = norm(sub(z.ball, z.pocket.target)); // direction away from pocket
  const halfFan = Math.min(skill.maxCut, (78 * Math.PI) / 180);
  const inner = 2 * BALL_R + 0.3;
  const ghost = zoneGhost(z);
  const nr = Math.floor((maxRadius - inner) / FAN_DR) + 1;
  const radius = (j: number) => inner + j * FAN_DR;

  // Classify the fan and remember each ray's direction.
  const dirs: Vec[] = [];
  const cls: Uint8Array[] = [];
  for (let i = 0; i <= FAN_STEPS; i++) {
    const dir = rotate(aimBack, -halfFan + (2 * halfFan * i) / FAN_STEPS);
    dirs.push(dir);
    const row = new Uint8Array(nr);
    for (let j = 0; j < nr; j++) {
      const p = add(z.ball, scale(dir, radius(j)));
      if (excludeRailBand && railExcluded(p, norm(sub(ghost, p)))) continue; // DEAD
      const v = zoneValue(p, z, skill);
      row[j] = v < minValue * BRIDGE_RELATIVE ? DEAD : v >= minValue ? CORE : FEAS;
    }
    cls.push(row);
  }

  // Window mask = core + feasible bracketed by core within a dead-free run,
  // taken both along each ray (radial) and across the fan at each radius
  // (angular). `bracket` walks one dead-free run and fills core..core.
  const win = cls.map(() => new Uint8Array(nr));
  const bracket = (len: number, at: (k: number) => number, set: (k: number) => void) => {
    for (let s = 0; s < len; ) {
      if (at(s) === DEAD) { s++; continue; }
      let e = s;
      while (e < len && at(e) !== DEAD) e++;
      let fc = -1;
      let lc = -1;
      for (let k = s; k < e; k++) if (at(k) === CORE) { if (fc < 0) fc = k; lc = k; }
      if (fc >= 0) for (let k = fc; k <= lc; k++) set(k);
      s = e;
    }
  };
  for (let i = 0; i <= FAN_STEPS; i++) {
    bracket(nr, (j) => cls[i][j], (j) => { win[i][j] = 1; });
  }
  for (let j = 0; j < nr; j++) {
    bracket(FAN_STEPS + 1, (i) => cls[i][j], (i) => { win[i][j] = 1; });
  }

  // Angular opening: erode then dilate across the fan, dissolving window wedges
  // thinner than OPEN_RAYS rays. A thin radial sliver — a long finger of "good"
  // cells that the next ball is technically pottable from but the cue ball
  // could only reach by overhitting — is a mishit, not a leave; opening removes
  // it (and disconnects thin necks, so keep-the-played-side then drops the
  // appendage) while leaving the body of the window untouched.
  const mask = openAngular(win, FAN_STEPS + 1, nr, OPEN_RAYS);
  // The spot the route actually plays for is by definition a real leave, not a
  // sliver: exempt a small disk around the landing from the opening so a
  // landing near an eroded edge stays inside the drawn window.
  if (landing) {
    for (let i = 0; i <= FAN_STEPS; i++) for (let j = 0; j < nr; j++) {
      if (win[i][j] && dist(add(z.ball, scale(dirs[i], radius(j))), landing) <= LANDING_KEEP) {
        mask[i][j] = 1;
      }
    }
  }

  // The fan cell the landing falls in, so the played lobe can be picked by cell
  // membership (robust where the annular polygon's concavities would fool a
  // point-in-polygon test). -1 if the landing is off the fan.
  const land = landing ? landingCell(landing, z.ball, aimBack, halfFan, inner, nr) : null;

  // Stitch the mask into lobes: per ray, runs of window cells (broken at any
  // gap), each extending the one lobe it radially overlaps. Sample endpoints
  // can be clear while the connecting edge crosses an obstacle's clearance
  // ring, so such edges also split runs and lobes.
  const pointAt = (i: number, j: number) => add(z.ball, scale(dirs[i], radius(j)));
  const edgeClear = (a: Vec, b: Vec) => z.obstacles.every(
    (o) => segmentClearsCircle(a, b, o, CUE_OBSTACLE_CLEARANCE),
  );
  const done: Lobe[] = [];
  const close = (l: Lobe) => { if (l.outer.length >= 2) done.push(l); };
  let open: Lobe[] = [];
  for (let i = 0; i <= FAN_STEPS; i++) {
    const runs: [number, number][] = [];
    let lo = -1;
    for (let j = 0; j < nr; j++) {
      if (lo >= 0 && mask[i][j] && !edgeClear(
        pointAt(i, j - 1),
        pointAt(i, j),
      )) {
        runs.push([lo, j - 1]);
        lo = -1;
      }
      if (mask[i][j]) { if (lo < 0) lo = j; }
      else if (lo >= 0) { runs.push([lo, j - 1]); lo = -1; }
    }
    if (lo >= 0) runs.push([lo, nr - 1]);
    // The run the landing sits in on its own ray tags its lobe as the played one.
    const landRun = land && i === land[0]
      ? runs.findIndex((run) => run[0] <= land[1] && land[1] <= run[1])
      : -1;

    const kept: Lobe[] = [];
    const used = new Set<number>();
    for (const l of open) {
      const k = runs.findIndex(
        (run, idx) => !used.has(idx) && run[0] <= l.last[1] && run[1] >= l.last[0]
          && edgeClear(l.outer[l.outer.length - 1], pointAt(i, run[1]))
          && edgeClear(l.inner[l.inner.length - 1], pointAt(i, run[0])),
      );
      if (k < 0) { close(l); continue; }
      used.add(k);
      l.outer.push(pointAt(i, runs[k][1]));
      l.inner.push(pointAt(i, runs[k][0]));
      l.cells += runs[k][1] - runs[k][0] + 1;
      l.last = runs[k];
      l.played = l.played || k === landRun;
      kept.push(l);
    }
    runs.forEach((run, idx) => {
      if (used.has(idx)) return;
      kept.push({
        outer: [pointAt(i, run[1])],
        inner: [pointAt(i, run[0])],
        last: run,
        cells: run[1] - run[0] + 1,
        played: idx === landRun,
      });
    });
    open = kept;
  }
  for (const l of open) close(l);

  if (done.length === 0) return null;
  let pick = done.find((l) => l.played);
  if (!pick) for (const l of done) if (!pick || l.cells > pick.cells) pick = l;
  return [[...pick!.outer, ...pick!.inner.reverse()]];
}

/** The (ray, radial) fan cell a point falls in, or null if off the fan. */
function landingCell(
  p: Vec,
  ball: Vec,
  aimBack: Vec,
  halfFan: number,
  inner: number,
  nr: number,
): [number, number] | null {
  const d = sub(p, ball);
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-6) return null;
  let phi = Math.atan2(d.y, d.x) - Math.atan2(aimBack.y, aimBack.x);
  while (phi > Math.PI) phi -= 2 * Math.PI;
  while (phi < -Math.PI) phi += 2 * Math.PI;
  const i = Math.round(((phi + halfFan) / (2 * halfFan)) * FAN_STEPS);
  const j = Math.round((len - inner) / FAN_DR);
  if (i < 0 || i > FAN_STEPS || j < 0 || j >= nr) return null;
  return [i, j];
}

/**
 * Morphological opening along the fan (erode then dilate by `rays` rays, at
 * each radius independently). Removes window wedges narrower than 2*rays+1 rays
 * — the thin radial slivers — while preserving the radial extent of everything
 * wider. Radial thinness is left alone: a wedge can be as short as it likes.
 */
function openAngular(m: Uint8Array[], ni: number, nj: number, rays: number): Uint8Array[] {
  if (rays <= 0) return m;
  const eroded = m.map(() => new Uint8Array(nj));
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      let all = true;
      for (let a = -rays; a <= rays; a++) {
        const ii = i + a;
        if (ii < 0 || ii >= ni || !m[ii][j]) { all = false; break; }
      }
      if (all) eroded[i][j] = 1;
    }
  }
  const out = m.map(() => new Uint8Array(nj));
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      if (!m[i][j]) continue;
      for (let a = -rays; a <= rays; a++) {
        const ii = i + a;
        if (ii >= 0 && ii < ni && eroded[ii][j]) { out[i][j] = 1; break; }
      }
    }
  }
  return out;
}
