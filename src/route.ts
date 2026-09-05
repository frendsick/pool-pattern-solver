// Route exploration (see CONTEXT.md: Route, Position Zone). Given a shot
// geometry and zone targets, find and score landing candidates. The solver
// (beam search) calls routeCandidates for fast pruning, then expectedNextPot
// for the full landing-spread quadrature on the top candidates.

import {
  Vec,
  add,
  sub,
  scale,
  norm,
  rotate,
  dist,
  distPointSegment,
  angleBetween,
} from './geometry';
import { Ball, Pocket, POCKETS, BALL_R, MIN_X, MAX_X, MIN_Y, MAX_Y } from './table';
import {
  ShotGeometry,
  ShotType,
  Sidespin,
  SIDESPINS,
  departureDir,
  minCueTravel,
  isStraight,
  shotGeometry,
  tracePath,
  traceShot,
  objectTravel,
  CaromCurve,
  caromCurve,
  caromLocus,
} from './shots';
import {
  ExitStep,
  SkillProfile,
  distanceSigma,
  directionSigma,
  perturbSamples,
  potProbability,
  routeEase,
  walkExit,
} from './skill';
import {
  ZoneContext,
  ZONE_FLOOR,
  ZONE_RELATIVE,
  RAIL_MARGIN,
  railExcluded,
  zoneContext,
  zoneGhost,
  zonePeak,
  zoneValue,
} from './zone';
import { ValueSurface, zoneInputsForBall } from './value';

export const MAX_ROUTE = 220;
export const WALK_STEP = 2.0;
const ZONE_VMIN = 0.15;
const SIMPLE_ROUTE_MAX_TRAVEL = 30;
// A long multi-rail path running along a narrow lobe still needs lateral
// control. Measure the local in-bar width across the route and require enough
// width for the route's direction spread before giving full window credit.
const WINDOW_WIDTH_STEP = 1;
const WINDOW_WIDTH_RANGE = 20;
const WINDOW_WIDTH_SIGMAS = 3;
/**
 * The strict pass keeps landings this far clear of the awkward rail band the
 * drawn window hard-excludes (buildPie, railExcluded — cueing away from a
 * near rail): a landing hugging the band's jagged edge would render on or
 * just outside the window boundary. Along-the-rail landings are fine.
 */
const LANDING_RAIL_INSET = RAIL_MARGIN + 1;

/**
 * Routes that skim a pocket mouth risk a scratch that the clean trace does
 * not see: penalize passes within SCRATCH_MARGIN of the capture radius.
 * Only passes ARRIVING within the pocket's acceptance cone count — the jaws
 * funnel a ball heading into the mouth, but a pass beyond the acceptance
 * angle (e.g. a rebound off the cushion just beside a side pocket) meets
 * cushion-backed facings and stays on the table; the residual chance of the
 * perturbed path entering the mouth itself is already priced by the
 * quadrature's scratch traces.
 */
const SCRATCH_MARGIN = 4;
const SCRATCH_FLOOR = 0.35;

/** Per-pocket zone target for one solver layer: shared by every node. */
export interface ZoneTarget {
  pocket: Pocket;
  /**
   * Onward-control-gated zone (the one the renderer draws, see scene.ts):
   * the route search measures intervals, bars and landings against it, so
   * the planned landing always sits inside the window the user sees.
   */
  zc: ZoneContext;
  /** Pot-only twin, for reporting the next shot's plain pot probability. */
  zcPot: ZoneContext;
}

export function zoneTargets(
  balls: Ball[],
  m: number,
  surfaces: (ValueSurface | null)[],
  skill: SkillProfile,
): ZoneTarget[] {
  const nextBall = balls[m];
  const { obstacles, gate } = zoneInputsForBall(balls, m, surfaces);
  const found: ZoneTarget[] = [];
  for (const pocket of POCKETS) {
    const zc = zoneContext(nextBall.pos, pocket, obstacles, [], gate);
    if (!zc.ballPathClear) continue;
    if (zonePeak(zc, skill) <= 0) continue;
    found.push({ pocket, zc, zcPot: zoneContext(nextBall.pos, pocket, obstacles) });
  }
  return found;
}

/** A scored landing candidate returned by routeCandidates. */
export interface RouteLanding {
  zc: ZoneContext;
  zcPot: ZoneContext;
  nextPocket: Pocket;
  type: ShotType;
  sidespin: Sidespin;
  dir: Vec;
  travel: number;
  rails: number;
  landing: Vec;
  windowRef: number;
  zoneLen: number | null;
  entryDeg: number | null;
  /**
   * The route's own merit: effective zone value (zone value x ease) times
   * stay factor. The solver multiplies this by the beam node's score to get
   * the proxy used for cross-node sorting.
   */
  merit: number;
  /**
   * Route ease at the chosen travel: type reliability x hit-power price x
   * draw rail-room. Multiplies the landing-spread expectation into e.
   */
  ease: number;
  /**
   * Control margin from the length of the path that stays inside the next
   * window relative to the route's speed spread. Used in the final position
   * expectation so a short crossing of a zone is not scored like a long run
   * through it.
   */
  windowFactor: number;
}

interface PathSample {
  s: number;
  p: Vec;
  rails: number;
  dirAt: Vec;
  v: number;
  /**
   * EFFECTIVE landing value: zone value priced by everything the route to
   * this point costs — the type's reliability, the hit power the travel
   * demands at this cut, draw rail-room. 0 before the pot-pace minimum
   * travel. This is the scale candidates and the landing bar live on, so an
   * easy natural follow into a decent spot outranks a hard draw into the
   * zone's richest one.
   */
  eff: number;
  /** In the rail band AND cueing away from it: excluded by the strict pass. */
  inBand: boolean;
}

/** Pocket-independent geometry and ease. Blocked samples split usable runs. */
interface RouteSample extends ExitStep {
  blocked?: boolean;
}

interface Interval {
  s0: number;
  s1: number;
  peakS: number;
  peakV: number;
  entryDir: Vec;
}

function pathEndDir(points: Vec[], fallback: Vec): Vec {
  for (let i = points.length - 2; i >= 0; i--) {
    const seg = sub(points[i + 1], points[i]);
    if (Math.hypot(seg.x, seg.y) > 1e-9) return norm(seg);
  }
  return fallback;
}

function onRail(p: Vec): boolean {
  return (
    p.x <= MIN_X + 1e-6 ||
    p.x >= MAX_X - 1e-6 ||
    p.y <= MIN_Y + 1e-6 ||
    p.y >= MAX_Y - 1e-6
  );
}

function firstRailDist(points: Vec[], rails: number): number | null {
  if (rails <= 0) return null;
  let travelled = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const segLen = dist(points[i], points[i + 1]);
    travelled += segLen;
    if (onRail(points[i + 1])) return travelled;
  }
  return null;
}

function exactCurveSamples(
  g: ShotGeometry,
  type: ShotType,
  sidespin: Sidespin,
  dir: Vec,
  obstacles: Vec[],
  skill: SkillProfile,
): RouteSample[] {
  const out: RouteSample[] = [];
  for (let travel = WALK_STEP; travel <= MAX_ROUTE; travel += WALK_STEP) {
    const tr = traceShot(g, type, travel, obstacles, { maxRails: 4, sidespin });
    const dirAt = pathEndDir(tr.points, dir);
    if (tr.outcome !== 'ok') {
      out.push({
        travel,
        point: tr.end,
        rails: tr.rails,
        dirAt,
        ease: 0,
        blocked: true,
      });
      continue;
    }
    const railDist = firstRailDist(tr.points, tr.rails);
    const ease = routeEase(g, type, sidespin, travel, tr.rails, railDist, skill, tr.powerTravel);
    out.push({
      travel,
      point: tr.end,
      rails: tr.rails,
      dirAt,
      ease,
    });
  }
  return out;
}

function samplePath(
  g: ShotGeometry,
  type: ShotType,
  sidespin: Sidespin,
  obstacles: Vec[],
  skill: SkillProfile,
  exactCurves = false,
): RouteSample[] | null {
  const locus = caromLocus(g, type);
  if (!locus) return null;
  const dir = departureDir(g, type);
  if (!dir) return null;
  const tr = tracePath(g.ghost, locus.dir, MAX_ROUTE * locus.eta, obstacles, {
    maxRails: 3,
    sidespin,
  });
  if ((exactCurves || tr.rails > 0 || tr.outcome !== 'ok') && caromCurve(g, type, MAX_ROUTE)) {
    return exactCurveSamples(g, type, sidespin, dir, obstacles, skill);
  }
  const firstSeg =
    tr.points.length > 2 ? dist(tr.points[0], tr.points[1]) : null;
  return Array.from(walkExit(
    tr.points, locus.eta, firstSeg, g, type, sidespin, skill, WALK_STEP, true,
  ));
}

function scoreSamples(
  samples: RouteSample[],
  sidespin: Sidespin,
  zc: ZoneContext,
  skill: SkillProfile,
): PathSample[] {
  const ghost = zoneGhost(zc);
  return samples.map((st) => {
    const v = st.blocked ? 0 : zoneValue(st.point, zc, skill);
    return {
      s: st.travel, p: st.point, rails: st.rails, dirAt: st.dirAt,
      v,
      eff: sidespin !== 0 && st.rails === 0 ? 0 : v * st.ease,
      inBand: !st.blocked && railExcluded(st.point, norm(sub(ghost, st.point)), LANDING_RAIL_INSET),
    };
  });
}

function findIntervals(
  samples: PathSample[],
  effMin = ZONE_VMIN,
  excludeRailBand = false,
): Interval[] {
  const intervals: Interval[] = [];
  let cur: PathSample[] = [];
  const flush = () => {
    if (cur.length >= 2) {
      let peak = cur[0];
      for (const q of cur) if (q.eff > peak.eff) peak = q;
      intervals.push({
        s0: cur[0].s,
        s1: cur[cur.length - 1].s,
        peakS: peak.s,
        peakV: peak.v,
        entryDir: cur[0].dirAt,
      });
    }
    cur = [];
  };
  for (const q of samples) {
    if (q.eff >= effMin && !(excludeRailBand && q.inBand)) cur.push(q);
    else flush();
  }
  flush();
  intervals.sort(
    (a, b) => (b.s1 - b.s0) * b.peakV - (a.s1 - a.s0) * a.peakV,
  );
  return intervals.slice(0, 2);
}

function sampleNear(samples: PathSample[], s: number): PathSample {
  let best = samples[0];
  let bestD = Infinity;
  for (const q of samples) {
    const d = Math.abs(q.s - s);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

function ownBar(samples: PathSample[]): number {
  let own = 0;
  for (const q of samples) if (q.eff > own) own = q.eff;
  return Math.max(ZONE_FLOOR, ZONE_RELATIVE * own);
}

function intervalTargets(
  iv: Interval,
  samples: PathSample[],
  type: ShotType,
  skill: SkillProfile,
  shotDist: number,
): number[] {
  const ivLen = iv.s1 - iv.s0;
  const endSmp = sampleNear(samples, iv.s1);
  const sigEnd = distanceSigma(type, iv.s1, endSmp.rails, skill, shotDist);
  const sDeep = Math.max(iv.s0, Math.max(iv.peakS, iv.s1 - 2 * sigEnd));
  return ivLen < 6
    ? [iv.peakS]
    : [iv.s0 + ivLen * 0.4, iv.s0 + ivLen * 0.65, iv.peakS, sDeep].filter(
        (s, i, all) => all.findIndex((o) => Math.abs(o - s) < 2) === i,
      );
}

function bestShortSimpleMerit(
  samples: PathSample[],
  type: ShotType,
  lenient: boolean,
  skill: SkillProfile,
  shotDist: number,
): number {
  let best = 0;
  for (const iv of findIntervals(samples, ownBar(samples), !lenient)) {
    const ivLen = iv.s1 - iv.s0;
    for (const sTarget of intervalTargets(iv, samples, type, skill, shotDist)) {
      const smp = sampleNear(samples, sTarget);
      if (smp.rails !== 0 || sTarget > SIMPLE_ROUTE_MAX_TRAVEL) continue;
      const sigS = distanceSigma(type, sTarget, smp.rails, skill, shotDist);
      const stayFactor = Math.min(1, ivLen / (3 * sigS));
      best = Math.max(best, smp.eff * stayFactor);
    }
  }
  return best;
}

function sideWidth(
  p: Vec,
  dir: Vec,
  zc: ZoneContext,
  skill: SkillProfile,
  minValue: number,
): number {
  let width = 0;
  for (let d = WINDOW_WIDTH_STEP; d <= WINDOW_WIDTH_RANGE; d += WINDOW_WIDTH_STEP) {
    if (zoneValue(add(p, scale(dir, d)), zc, skill) < minValue) break;
    width += WINDOW_WIDTH_STEP;
  }
  return width;
}

function localWindowWidth(
  p: Vec,
  pathDir: Vec,
  zc: ZoneContext,
  skill: SkillProfile,
  minValue: number,
): number {
  if (zoneValue(p, zc, skill) < minValue) return 0;
  const perp = rotate(pathDir, Math.PI / 2);
  return (
    WINDOW_WIDTH_STEP +
    sideWidth(p, perp, zc, skill, minValue) +
    sideWidth(p, scale(perp, -1), zc, skill, minValue)
  );
}

function widthControlFactor(
  width: number,
  travel: number,
  type: ShotType,
  sidespin: Sidespin,
  rails: number,
  g: ShotGeometry,
  skill: SkillProfile,
): number {
  if (rails < 2) return 1;
  const lateralSigma = travel * Math.sin(
    directionSigma(type, rails, skill, g.dCueGhost, undefined, false, sidespin),
  );
  const required = WINDOW_WIDTH_SIGMAS * Math.max(1, lateralSigma);
  return Math.min(1, Math.sqrt(width / required));
}

function redundantLongFollowFactor(
  type: ShotType,
  rails: number,
  travel: number,
  simpleEff: number,
  routeEff: number,
): number {
  // If a short no-rail stop/stun/low/draw route already reaches about the
  // same window, do not let a long rail-follow win on zone size alone. The
  // short route also stays INSIDE the window the whole way, while the rail
  // follow loops far outside it (seed 775832494 shot 7: a 47" follow grazing
  // ~45% of its path outside the 8's window, beaten by an in-window touch).
  // This penalty is gated on `closeness` (a comparable in-window route must
  // exist), so a long follow that is the ONLY way to a far window — the
  // handball/along-window routes the player explicitly wants — keeps its full
  // value (closeness < 0.55 returns 1 long before the ramp).
  if (type !== 'follow' || rails === 0 || travel < 35 || simpleEff <= 0 || routeEff <= 0) {
    return 1;
  }
  const closeness = simpleEff / routeEff;
  if (closeness < 0.55) return 1;
  const closeT = Math.min(1, (closeness - 0.55) / 0.15);
  // Ramp fast in travel: by the mid-40s the in-window route should clearly
  // win when it is comparable. A rail loop at that speed is no longer a
  // harmless tie-break against a stop/touch that is already in the window.
  const travelT = Math.min(1, (travel - 30) / 15);
  const allowedVsSimple = 1 - 0.4 * travelT;
  const capFactor = Math.min(1, (simpleEff * allowedVsSimple) / routeEff);
  return 1 - (1 - capFactor) * closeT * travelT;
}

/** Angle (deg) between a path direction and the line of a shot, mod 180. */
export function lineAngleDeg(pathDir: Vec, zc: ZoneContext): number {
  const aim = norm(sub(zc.pocket.target, zc.ball));
  const a = angleBetween(pathDir, aim);
  return (Math.min(a, Math.PI - a) * 180) / Math.PI;
}

/**
 * Worst-case penalty for a hazard the clean trace cannot see: full strength
 * (down to `floor`) at dead contact, ramping linearly back to 1 (no effect)
 * once the edge gap reaches `margin`. Shared by clearanceRisk and pocketRisk.
 */
function rampPenalty(clear: number, margin: number, floor: number): number {
  if (clear >= margin) return 1;
  return floor + ((1 - floor) * Math.max(0, clear)) / margin;
}

/**
 * Closest approach (center-to-`target` distance) of any path segment,
 * optionally restricted to segments whose direction `accept`s. Degenerate
 * (zero-length) segments are skipped.
 */
function nearestApproach(
  path: Vec[],
  target: Vec,
  accept?: (seg: Vec) => boolean,
): number {
  let d = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const seg = sub(path[i + 1], path[i]);
    if (Math.hypot(seg.x, seg.y) < 1e-9) continue;
    if (accept && !accept(seg)) continue;
    d = Math.min(d, distPointSegment(target, path[i], path[i + 1]));
  }
  return d;
}

/**
 * Edge clearance (inches) below which the cue ball's lane past a NON-target
 * ball counts as blocked, and the worst-case penalty at dead contact.
 *
 * A route that threads close past a ball it is not playing for is risky in a
 * way the landing-spread quadrature cannot resolve: that quadrature samples
 * the departure direction only at 0 and +/-1.732 sigma, so a centerline that
 * grazes a ball at near-zero clearance still scores as a clean miss for all
 * the probability mass between the nodes, while in reality much of it clips
 * the ball — wrecking the planned position and disturbing a ball not yet
 * played. This is the object-ball twin of pocketRisk (a collision the clean
 * trace does not see). BLOCK_MARGIN asks for a ball-radius of daylight past
 * the surface (center-to-center >= 3R) before the lane reads as open; a tight
 * but real lane (a follow that passes a rail's width clear) is left alone.
 *
 * BLOCK_FLOOR is deliberately gentle. This penalty rides on `score` (the
 * run-out probability), so it competes head-to-head with the route economics
 * that drive "keep it simple" — and a heavy multiplier does not just reject
 * the threaded route, it can re-route the WHOLE rack into longer follows to
 * dodge one near-miss (seed 775832494: a 0.5 floor turned a 4" stop-in into a
 * 38" one-rail follow because a later draw skimmed the 7). A graze is a glance,
 * not a scratch, so the worst case costs only a few percent — enough to break
 * a genuine near-tie (seed 1147167, where the open line was within ~3% of the
 * blocked one) without overriding a real difference in run-out value.
 */
const BLOCK_MARGIN = BALL_R;
const BLOCK_FLOOR = 0.93;

/**
 * Penalty for a cue-ball path that threads close past balls it is not playing
 * position for (`later` excludes the next/target ball — coming near that one
 * is the route's whole point, and its landing clearance is gated by the zone).
 * Worst grazed ball decides; no effect once every lane is open by BLOCK_MARGIN.
 */
export function clearanceRisk(path: Vec[], later: Vec[]): number {
  let worst = 1;
  for (const ball of later) {
    const clear = nearestApproach(path, ball) - 2 * BALL_R;
    worst = Math.min(worst, rampPenalty(clear, BLOCK_MARGIN, BLOCK_FLOOR));
  }
  return worst;
}

export function pocketRisk(path: Vec[]): number {
  let worst = 1;
  for (const p of POCKETS) {
    const clear =
      nearestApproach(path, p.captureCenter, (seg) => angleBetween(seg, p.facing) <= p.acceptance) -
      p.captureRadius;
    worst = Math.min(worst, rampPenalty(clear, SCRATCH_MARGIN, SCRATCH_FLOOR));
  }
  return worst;
}

/** The final ball's safety Route: a pocket, shot type, and traced cue path. */
export interface FinalRoute {
  pocket: Pocket;
  g: ShotGeometry;
  type: ShotType;
  sidespin: Sidespin;
  potProb: number;
  /** P(no scratch) priced by pocketRisk over the traced cue path. */
  noScratch: number;
  path: Vec[];
  landing: Vec;
  travel: number;
  rails: number;
  /** Free-cloth cue travel equivalent of the required impact energy. */
  powerTravel: number;
}

/**
 * Shot types tried for the final ball, easiest first — so a tie in
 * P(pot) x P(no scratch) resolves toward the simpler stroke. The stop shot is
 * only offered on a straight cut. Other cuts retain tangent motion.
 */
const FINAL_TYPE_ORDER: ShotType[] = ['stop', 'follow', 'stun', 'lowTouch', 'draw'];

/**
 * Choose the final ball's Route. The 9 has no next Position Window to reach, so
 * its Route is chosen for SAFETY: from the fixed arrival cue position, enumerate
 * every open pocket x shot type at minimal natural travel (a soft, position-free
 * stroke — pot it and don't sell out), trace the cue path, and pick the route
 * maximizing P(pot) x P(no scratch), tie-breaking toward the easiest shot type.
 *
 * Scratch is priced through the SAME pocketRisk machinery as mid-rack scratch
 * (probabilistic, not a hard binary reject): a route whose trace runs straight
 * into a pocket is floored at SCRATCH_FLOOR rather than discarded, so a 9 whose
 * every pocket only scratches collapses this leg on score — and generation
 * rejects that layout the same way it rejects one with no complete Pattern.
 *
 * No object balls remain when the 9 is shot, so the trace sees only cushions
 * and pocket mouths (obstacles = []). Returns null only if no pocket is
 * pottable with a complete trace from the arrival position.
 */
export function finalSafetyRoute(
  cue: Vec,
  ballPos: Vec,
  skill: SkillProfile,
): FinalRoute | null {
  let best: FinalRoute | null = null;
  let bestScore = -1;
  let bestRank = Infinity;
  for (const pocket of POCKETS) {
    const g = shotGeometry(cue, ballPos, pocket);
    if (!g) continue;
    const potProb = potProbability(g, pocket, skill);
    if (potProb <= 0) continue;
    const stoppable = isStraight(g);
    for (let rank = 0; rank < FINAL_TYPE_ORDER.length; rank++) {
      const type = FINAL_TYPE_ORDER[rank];
      let travel: number;
      if (type === 'stop') {
        if (!stoppable) continue;
        // The cue stays put; a short stub down the aim line prices the
        // follow-in scratch (an under-killed stop creeps toward the pocket).
        travel = 0.5;
      } else {
        const d = departureDir(g, type);
        if (!d) continue;
        travel = Math.max(minCueTravel(g, type), WALK_STEP);
      }
      const tr = traceShot(g, type, travel, [], { maxRails: 4 });
      if (tr.outcome !== 'ok' && tr.outcome !== 'scratch') continue;
      const noScratch = tr.outcome === 'scratch' ? SCRATCH_FLOOR : pocketRisk(tr.points);
      const pacedPot = potProbability(g, pocket, skill, objectTravel(g, type, tr.powerTravel));
      const score = pacedPot * noScratch;
      if (score > bestScore + 1e-9 || (score > bestScore - 1e-9 && rank < bestRank)) {
        best = {
          pocket, g, type, sidespin: 0, potProb: pacedPot, noScratch,
          path: tr.points, landing: type === 'stop' ? g.ghost : tr.end, travel, rails: tr.rails,
          powerTravel: tr.powerTravel,
        };
        bestScore = score;
        bestRank = rank;
      }
    }
  }
  return best;
}

/**
 * Expected pot probability of the next shot over the landing distribution of
 * this route — the Position Zone factor of the score.
 */
export function expectedNextPot(
  start: Vec,
  baseDir: Vec,
  travel: number,
  type: ShotType,
  railsIntended: number,
  obstacles: Vec[],
  zc: ZoneContext,
  skill: SkillProfile,
  shotDist = 0,
  carom?: { g: ShotGeometry; pocket: Pocket },
  curve?: CaromCurve,
  fromHand = false,
  sidespin: Sidespin = 0,
): number {
  const sigS = distanceSigma(type, travel, railsIntended, skill, shotDist);
  const sigD = directionSigma(type, railsIntended, skill, shotDist, carom, fromHand, sidespin);
  let e = 0;
  for (const smp of perturbSamples(sigS, sigD)) {
    const tRaw = travel + smp.dDist;
    const flip = type === 'stop' && tRaw < 0;
    const dir = rotate(flip ? scale(baseDir, -1) : baseDir, smp.dDir);
    const t = Math.max(0.1, type === 'stop' ? Math.abs(tRaw) : tRaw);
    const ratio = travel > 0 ? t / travel : 1;
    const cv = !carom && curve ? {
      offsets: curve.offsets.map((o) => rotate(scale(o, ratio), smp.dDir)),
      arc: curve.arc * ratio,
    } : undefined;
    const tr = carom
      ? traceShot(carom.g, type, t, obstacles, { maxRails: 4, sidespin,
        directionError: smp.dDir + (flip ? Math.PI : 0) })
      : tracePath(start, dir, t, obstacles, { maxRails: 4, curve: cv, sidespin });
    if (tr.outcome !== 'ok') continue;
    e += smp.weight * zoneValue(tr.end, zc, skill);
  }
  return e;
}

/**
 * Find scored landing candidates for a shot geometry against zone targets.
 * Returns route-level merit (effective value x stay factor) — the solver
 * multiplies by the beam node's score to get the cross-node proxy.
 */
export function routeCandidates(
  g: ShotGeometry,
  obstacles: Vec[],
  targets: ZoneTarget[],
  skill: SkillProfile,
  lenient: boolean,
): RouteLanding[] {
  const out: RouteLanding[] = [];
  const stoppable = isStraight(g);
  // A route's geometry is shared by every pocket. Keep scoring in target order
  // because each zone memoizes onward control from its first sampled position.
  const paths = new Map<string, RouteSample[] | null>();
  const samplesForTarget = (type: ShotType, sidespin: Sidespin, zc: ZoneContext) => {
    const key = `${type}:${sidespin}`;
    if (!paths.has(key)) {
      paths.set(key, samplePath(g, type, sidespin, obstacles, skill, lenient));
    }
    const path = paths.get(key);
    return path ? scoreSamples(path, sidespin, zc, skill) : null;
  };

  interface Sampled {
    t: ZoneTarget;
    type: ShotType;
    sidespin: Sidespin;
    dir: Vec;
    samples: PathSample[];
  }
  const sampled: Sampled[] = [];
  const stopEase = routeEase(g, 'stop', 0, 0, 0, null, skill);
  const stopEff = (t: ZoneTarget): number => zoneValue(g.ghost, t.zc, skill) * stopEase;
  let nodeMax = 0;
  for (const t of targets) {
    if (stoppable) {
      const landingDir = norm(sub(zoneGhost(t.zc), g.ghost));
      if (lenient || !railExcluded(g.ghost, landingDir, LANDING_RAIL_INSET)) {
        nodeMax = Math.max(nodeMax, stopEff(t));
      }
    }
    for (const type of ['follow', 'stun', 'lowTouch', 'draw'] as ShotType[]) {
      const dir = departureDir(g, type);
      if (!dir) continue;
      const neutral = samplesForTarget(type, 0, t.zc);
      if (!neutral) continue;
      for (const q of neutral) {
        if (!lenient && q.inBand) continue;
        if (q.eff > nodeMax) nodeMax = q.eff;
      }
      sampled.push({ t, type, sidespin: 0, dir, samples: neutral });

      const neutralUsable = neutral.some((q) => q.eff >= ZONE_VMIN && (lenient || !q.inBand));
      if (neutralUsable) continue;
      for (const sidespin of SIDESPINS) {
        if (sidespin === 0) continue;
        const samples = samplesForTarget(type, sidespin, t.zc);
        if (!samples) continue;
        for (const q of samples) {
          if (!lenient && q.inBand) continue;
          if (q.eff > nodeMax) nodeMax = q.eff;
        }
        sampled.push({ t, type, sidespin, dir, samples });
      }
    }
  }
  const nodeBar = Math.max(ZONE_FLOOR, ZONE_RELATIVE * nodeMax);
  const simpleEffByTarget = new Map<ZoneTarget, number>();
  const rememberSimple = (t: ZoneTarget, eff: number) => {
    if (eff > (simpleEffByTarget.get(t) ?? 0)) simpleEffByTarget.set(t, eff);
  };

  for (const t of targets) {
    if (stoppable) rememberSimple(t, stopEff(t));
  }
  for (const { t, type, samples } of sampled) {
    if (type === 'follow') continue;
    const simple = bestShortSimpleMerit(samples, type, lenient, skill, g.dCueGhost);
    rememberSimple(t, simple);
  }

  for (const t of targets) {
    const { pocket, zc, zcPot } = t;
    if (stoppable) {
      const landing = g.ghost;
      const v = zoneValue(landing, zc, skill);
      const landingDir = norm(sub(zoneGhost(zc), landing));
      const eff = v * stopEase;
      const bar = lenient ? Math.max(ZONE_FLOOR, ZONE_RELATIVE * eff) : nodeBar;
      if (eff >= bar && (lenient || !railExcluded(landing, landingDir, LANDING_RAIL_INSET))) {
        out.push({
          zc, zcPot, nextPocket: pocket,
          type: 'stop', sidespin: 0, dir: g.aim, travel: 0.5, rails: 0,
          landing, windowRef: v, zoneLen: null, entryDeg: null,
          merit: eff,
          ease: stopEase,
          windowFactor: 1,
        });
      }
    }
  }

  for (const { t, type, sidespin, dir, samples } of sampled) {
    const { pocket, zc, zcPot } = t;
    const simpleHere = simpleEffByTarget.get(t) ?? 0;
    const bar = lenient ? ownBar(samples) : nodeBar;
    const intervals = findIntervals(samples, bar, !lenient);
    for (const iv of intervals) {
      const ivLen = iv.s1 - iv.s0;
      for (const sTarget of intervalTargets(iv, samples, type, skill, g.dCueGhost)) {
        const tr = traceShot(g, type, sTarget, obstacles, { maxRails: 4, sidespin });
        if (tr.outcome !== 'ok') continue;
        const rails = tr.rails;
        const baseEase = routeEase(g, type, sidespin, sTarget, rails,
          firstRailDist(tr.points, rails), skill, tr.powerTravel);
        if (baseEase <= 0.02) continue;
        const v = zoneValue(tr.end, zc, skill);
        const eff = v * baseEase;
        if (eff < bar || (!lenient && railExcluded(tr.end,
          norm(sub(zoneGhost(zc), tr.end)), LANDING_RAIL_INSET))) continue;
        const sigS = distanceSigma(type, sTarget, rails, skill, g.dCueGhost);
        const stayFactor = Math.min(1, ivLen / (3 * sigS));
        const rawWidthBar = Math.min(1, bar / baseEase);
        const widthFactor = widthControlFactor(
          localWindowWidth(tr.end, pathEndDir(tr.points, dir), zc, skill, rawWidthBar),
          sTarget,
          type,
          sidespin,
          rails,
          g,
          skill,
        );
        const windowFactor = Math.sqrt(stayFactor) * widthFactor;
        const simpleFactor = redundantLongFollowFactor(
          type,
          rails,
          sTarget,
          simpleHere,
          eff * stayFactor,
        );
        const ease = baseEase * simpleFactor;
        if (ease <= 0.02) continue;
        out.push({
          zc, zcPot, nextPocket: pocket,
          type, sidespin, dir, travel: sTarget, rails,
          landing: tr.end,
          windowRef: Math.min(iv.peakV, v / ZONE_RELATIVE),
          zoneLen: ivLen,
          entryDeg: lineAngleDeg(iv.entryDir, zc),
          merit: eff * simpleFactor * stayFactor,
          ease,
          windowFactor,
        });
      }
    }
  }
  return out;
}
