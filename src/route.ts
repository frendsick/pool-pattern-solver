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
import { Ball, Pocket, POCKETS } from './table';
import {
  ShotGeometry,
  ShotType,
  departureDir,
  minCueTravel,
  hitDistance,
  tracePath,
  CaromCurve,
  caromCurve,
  caromLocus,
} from './shots';
import {
  SkillProfile,
  distanceSigma,
  directionSigma,
  drawRailFactor,
  perturbSamples,
  powerFactor,
  routeReliability,
} from './skill';
import {
  NextValueFn,
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

export const MAX_ROUTE = 220;
export const WALK_STEP = 2.0;
const ZONE_VMIN = 0.15;
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
  nextBall: Ball,
  laterBalls: Ball[],
  skill: SkillProfile,
  nextValue: NextValueFn | undefined,
): ZoneTarget[] {
  const zoneObstacles = laterBalls.map((b) => b.pos);
  const found: ZoneTarget[] = [];
  for (const pocket of POCKETS) {
    const zc = zoneContext(nextBall.pos, pocket, zoneObstacles, [], nextValue);
    if (!zc.ballPathClear) continue;
    if (zonePeak(zc, skill) <= 0) continue;
    found.push({ pocket, zc, zcPot: zoneContext(nextBall.pos, pocket, zoneObstacles) });
  }
  return found;
}

/** A scored landing candidate returned by routeCandidates. */
export interface RouteLanding {
  zc: ZoneContext;
  zcPot: ZoneContext;
  nextPocket: Pocket;
  type: ShotType;
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

interface Interval {
  s0: number;
  s1: number;
  peakS: number;
  peakV: number;
  entryDir: Vec;
}

function samplePath(
  g: ShotGeometry,
  type: ShotType,
  obstacles: Vec[],
  zc: ZoneContext,
  skill: SkillProfile,
): PathSample[] | null {
  const locus = caromLocus(g, type);
  if (!locus) return null;
  const tr = tracePath(g.ghost, locus.dir, MAX_ROUTE * locus.eta, obstacles, 3);
  const out: PathSample[] = [];
  const ghost = zoneGhost(zc);
  const minTravel = minCueTravel(g, type);
  const rel = routeReliability(type, g.dCueGhost, skill);
  const firstSeg =
    tr.points.length > 2 ? dist(tr.points[0], tr.points[1]) : null;
  let s = 0;
  for (let i = 0; i + 1 < tr.points.length; i++) {
    const a = tr.points[i];
    const b = tr.points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-9) continue;
    const d = norm(sub(b, a));
    const railFac = i === 0 ? 1 : drawRailFactor(type, firstSeg, skill);
    for (let t = i === 0 ? WALK_STEP : 0; t <= segLen; t += WALK_STEP) {
      const travel = (s + t) / locus.eta;
      const p = add(a, scale(d, t));
      const v = zoneValue(p, zc, skill);
      const ease =
        travel < minTravel
          ? 0
          : rel * railFac * powerFactor(hitDistance(g, type, travel), skill);
      out.push({
        s: travel, p, rails: i, dirAt: d,
        v,
        eff: v * ease,
        inBand: railExcluded(p, norm(sub(ghost, p)), LANDING_RAIL_INSET),
      });
    }
    s += segLen;
  }
  return out;
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

/** Angle (deg) between a path direction and the line of a shot, mod 180. */
export function lineAngleDeg(pathDir: Vec, zc: ZoneContext): number {
  const aim = norm(sub(zc.pocket.target, zc.ball));
  const a = angleBetween(pathDir, aim);
  return (Math.min(a, Math.PI - a) * 180) / Math.PI;
}

export function pocketRisk(path: Vec[]): number {
  let worst = 1;
  for (const p of POCKETS) {
    let d = Infinity;
    for (let i = 0; i + 1 < path.length; i++) {
      const seg = sub(path[i + 1], path[i]);
      if (Math.hypot(seg.x, seg.y) < 1e-9) continue;
      if (angleBetween(seg, p.facing) > p.acceptance) continue;
      d = Math.min(d, distPointSegment(p.target, path[i], path[i + 1]));
    }
    const clear = d - p.captureRadius;
    if (clear < SCRATCH_MARGIN) {
      worst = Math.min(worst, 0.35 + (0.65 * Math.max(0, clear)) / SCRATCH_MARGIN);
    }
  }
  return worst;
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
): number {
  const sigS = distanceSigma(type, travel, railsIntended, skill, shotDist);
  const sigD = directionSigma(type, railsIntended, skill, shotDist, carom, fromHand);
  let e = 0;
  for (const smp of perturbSamples(sigS, sigD)) {
    const tRaw = travel + smp.dDist;
    const flip = type === 'stop' && tRaw < 0;
    const dir = rotate(flip ? scale(baseDir, -1) : baseDir, smp.dDir);
    const cv =
      curve && smp.dDir !== 0
        ? { offsets: curve.offsets.map((o) => rotate(o, smp.dDir)), arc: curve.arc }
        : curve;
    const t = Math.max(0.1, type === 'stop' ? Math.abs(tRaw) : tRaw);
    const tr = tracePath(start, dir, t, obstacles, 4, cv);
    if (tr.outcome === 'scratch') continue;
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
  const stoppable = g.cut < (9 * Math.PI) / 180;

  interface Sampled {
    t: ZoneTarget;
    type: ShotType;
    dir: Vec;
    samples: PathSample[];
  }
  const sampled: Sampled[] = [];
  const stopEff = (t: ZoneTarget): number =>
    zoneValue(g.ghost, t.zc, skill) * skill.typeReliability.stop;
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
      const samples = samplePath(g, type, obstacles, t.zc, skill);
      if (!samples) continue;
      for (const q of samples) {
        if (!lenient && q.inBand) continue;
        if (q.eff > nodeMax) nodeMax = q.eff;
      }
      sampled.push({ t, type, dir, samples });
    }
  }
  const nodeBar = Math.max(ZONE_FLOOR, ZONE_RELATIVE * nodeMax);

  for (const t of targets) {
    const { pocket, zc, zcPot } = t;
    if (stoppable) {
      const landing = g.ghost;
      const v = zoneValue(landing, zc, skill);
      const landingDir = norm(sub(zoneGhost(zc), landing));
      const eff = v * skill.typeReliability.stop;
      const bar = lenient ? Math.max(ZONE_FLOOR, ZONE_RELATIVE * eff) : nodeBar;
      if (eff >= bar && (lenient || !railExcluded(landing, landingDir, LANDING_RAIL_INSET))) {
        out.push({
          zc, zcPot, nextPocket: pocket,
          type: 'stop', dir: g.aim, travel: 0.5, rails: 0,
          landing, windowRef: v, zoneLen: null, entryDeg: null,
          merit: eff,
          ease: skill.typeReliability.stop,
        });
      }
    }
  }

  for (const { t, type, dir, samples } of sampled) {
    const { pocket, zc, zcPot } = t;
    let bar = nodeBar;
    if (lenient) {
      let own = 0;
      for (const q of samples) if (q.eff > own) own = q.eff;
      bar = Math.max(ZONE_FLOOR, ZONE_RELATIVE * own);
    }
    const intervals = findIntervals(samples, bar, !lenient);
    for (const iv of intervals) {
      const ivLen = iv.s1 - iv.s0;
      const endSmp = sampleNear(samples, iv.s1);
      const sigEnd = distanceSigma(type, iv.s1, endSmp.rails, skill, g.dCueGhost);
      const sDeep = Math.max(iv.s0, Math.max(iv.peakS, iv.s1 - 2 * sigEnd));
      const sTargets =
        ivLen < 6
          ? [iv.peakS]
          : [iv.s0 + ivLen * 0.4, iv.s0 + ivLen * 0.65, iv.peakS, sDeep].filter(
              (s, i, all) => all.findIndex((o) => Math.abs(o - s) < 2) === i,
            );
      for (const sTarget of sTargets) {
        const smp = sampleNear(samples, sTarget);
        const ease = smp.v > 0 ? smp.eff / smp.v : 0;
        if (ease <= 0.02) continue;
        const rails = smp.rails;
        const tr = tracePath(
          g.ghost, dir, sTarget, obstacles, 4,
          caromCurve(g, type, sTarget) ?? undefined,
        );
        if (tr.outcome !== 'ok') continue;
        const sigS = distanceSigma(type, sTarget, rails, skill, g.dCueGhost);
        const stayFactor = Math.min(1, ivLen / (3 * sigS));
        out.push({
          zc, zcPot, nextPocket: pocket,
          type, dir, travel: sTarget, rails,
          landing: tr.end,
          windowRef: Math.min(iv.peakV, smp.v / ZONE_RELATIVE),
          zoneLen: ivLen,
          entryDeg: lineAngleDeg(iv.entryDir, zc),
          merit: smp.eff * stayFactor,
          ease,
        });
      }
    }
  }
  return out;
}
