// Skill Profile (see CONTEXT.md): every probability in the solver comes from
// this parameter object, so a skill slider later is a pure profile swap
// (ADR-0002). v1 ships one fixed intermediate profile.

import { Vec } from './geometry';
import { BALL_R, Pocket, effectiveAcceptance } from './table';
import {
  ShotGeometry,
  ShotType,
  approachDeviation,
  signedRollShare,
  minCueTravel,
  hitDistance,
} from './shots';

export interface SkillProfile {
  /** Std dev of the cue aim direction error, radians. */
  aimSigma: number;
  /**
   * Std dev of object-ball direction noise at contact (cut-induced throw,
   * cloth roll-off), radians. Unlike aim error it is NOT amplified by cue
   * travel — but the pocket's angular window shrinks with ball-to-pocket
   * distance while this noise stays, so long pots are punished even with the
   * cue ball parked close behind: closer pockets need much less accuracy.
   */
  throwSigma: number;
  /** Hard cap on makeable cut angle, radians. */
  maxCut: number;
  /** Cuts beyond this (~a quarter-ball hit) need the cue ball close. */
  comfortCut: number;
  /**
   * Cuts get gradually harder past this angle (~30°): the aim-error
   * amplification of the model alone is too forgiving for half-ball-plus
   * cuts. Below it pots are at full ease; above, the effective aim noise
   * grows by cutGrowth per radian of extra cut.
   */
  cutSweetMax: number;
  cutGrowth: number;
  /** Max cue-to-ball distance for cuts beyond comfortCut, inches. */
  thinCutMaxDist: number;
  /** Relative speed (travel distance) error per shot type. */
  speedSigma: Record<ShotType, number>;
  /**
   * Floor on landing-distance error, inches. Even a short positional touch
   * is not surgical — landing in a small window is never guaranteed — which
   * is what makes a longer natural route into a BIG window the better play,
   * and the stop shot (which truly stays put) the easiest of all.
   */
  speedSigmaFloor: Record<ShotType, number>;
  /** Departure direction error per shot type, radians. */
  dirSigma: Record<ShotType, number>;
  /** Extra departure-direction error per cushion contact, radians. */
  railDirSigma: number;
  /**
   * Draw needs more power the longer the shot: extra error multiplier per
   * thinCutMaxDist (~1 m) of cue-to-ball distance beyond the first.
   */
  drawDistFactor: number;
  /**
   * A draw SHORTER than thinCutMaxDist is proportionally easier to execute
   * cleanly (keeping backspin over half a meter is routine), so its
   * reliability exponent shrinks with distance down to this floor. This is
   * the aggression headroom of an easy, quite-short shot: maximum draw to get
   * closer to the next ball is then barely costlier than a touch of low.
   * Only the clean-action reliability eases — the landing spread keeps its
   * draw-sized sigmas, so draw stays the toughest type to land precisely.
   */
  drawShortEase: number;
  /**
   * Killing the cue ball dead gets harder with distance: the backspin decays
   * on the way, so the speed/spin budget must zero out exactly at contact —
   * a small imperfection leaves the cue ball drifting off the spot. Extra
   * landing-sigma inches per inch of cue-to-ball distance for the stop shot
   * (a 10″ stop is still surgical; a 40″ one is not).
   */
  stopDrift: number;
  /**
   * Distance error damping per cushion. Cushions act as brakes (distance is
   * quadratic in speed, so the roll remaining after a cushion compresses any
   * speed error), which is WHY pros drive the cue ball into a rail behind
   * the position window: the rebound folds the landing spread back along the
   * shooting line — a shot wherever the ball stops, even accidentally
   * straight — instead of arriving in the window only at the end of travel.
   */
  railBrake: number;
  /** Extra distance noise per cushion, inches. */
  railNoise: number;
  /** Cut below which multi-rail follow off an inherited leave is rigid. */
  straightFollowMultiRailCut: number;
  /** Reliability for each extra rail on that near-straight follow route. */
  straightFollowMultiRailReliability: number;
  /**
   * Comfort scale for the cue-ball travel a shot FORCES (pocket pace at the
   * cut angle): a cut that makes the cue ball run t inches whether you like
   * it or not feels exp(-t/scale) as safe as a stoppable one. Travel you
   * CHOOSE along a natural line is not penalized — the window is long along
   * the shot line. Shapes Position Zones.
   */
  positionTravelScale: number;
  /**
   * P(executing the shot type's cue-ball action cleanly). Draw is always the
   * toughest of the available shots; its reliability decays further with
   * cue-to-ball distance (see routeReliability).
   */
  typeReliability: Record<ShotType, number>;
  /**
   * Draw (and, half as much, a touch of low) needs the cue ball to have room
   * for the backspin to act before the first cushion: a tangent line that
   * runs into a rail within this many inches compromises the action — the
   * idealized instant-bend path stops being trustworthy.
   */
  drawRailRoom: number;
  /**
   * With ball in hand the player spots the cue ball for an exact, rehearsed
   * shot, so the INTENDED carom path is far more predictable than from an
   * arbitrary leave (no inherited angle to read off the table). Multiplier
   * (<1) on the non-cushion part of the departure-direction error for routes
   * played from hand; cushion rebound noise stays — that is the table's.
   */
  handDirEase: number;
  /**
   * Hit-power comfort and ceiling, in equivalent roll-out inches of the hit
   * (hitDistance in shots.ts). Up to hitComfort the pot is unaffected; a
   * route's value decays to zero at hitMax — past that the shot needs to be
   * hit so hard the pot stops being realistic. This is what forbids long
   * sideways stun/draw routes off a near-straight shot while allowing
   * straight-ish follow to be powered through top spin.
   */
  hitComfort: number;
  hitMax: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

export const INTERMEDIATE: SkillProfile = {
  aimSigma: 0.003,
  throwSigma: 0.02,
  maxCut: deg(60),
  comfortCut: deg(48),
  cutSweetMax: deg(30),
  cutGrowth: 1.6, // x1.5 effective aim noise at 48 deg, x1.84 at 60 deg
  thinCutMaxDist: 39.4, // 1 m
  speedSigma: { stop: 0.04, follow: 0.1, lowTouch: 0.11, stun: 0.13, draw: 0.18 },
  speedSigmaFloor: { stop: 1, follow: 3, lowTouch: 3.5, stun: 3.5, draw: 4 },
  dirSigma: {
    stop: deg(0.8),
    follow: deg(1.2),
    lowTouch: deg(1.4),
    stun: deg(1.6),
    draw: deg(2.2),
  },
  railDirSigma: deg(0.9),
  drawDistFactor: 0.9,
  drawShortEase: 0.5, // 0.85^0.5 ~ 0.92 reliability for a very short draw
  stopDrift: 0.06, // ~3.5" landing sigma on a 40" stop, ~1.6" at 10"
  railBrake: 0.65,
  railNoise: 0.6,
  straightFollowMultiRailCut: deg(8),
  straightFollowMultiRailReliability: 0.75,
  positionTravelScale: 45,
  typeReliability: { stop: 0.99, follow: 0.98, lowTouch: 0.96, stun: 0.93, draw: 0.85 },
  drawRailRoom: 10,
  handDirEase: 0.5,
  // 300" (~7.6 m equivalent roll-out): a firm position follow is a routine
  // stroke, not a power shot. Monster sideways routes from nearly straight
  // hits still sit far beyond this and decay to zero at hitMax.
  hitComfort: 300,
  hitMax: 700,
};

/**
 * Multiplier on a route's probability from the hit power it demands
 * (hitDist = equivalent roll-out of the hit, see hitDistance in shots.ts):
 * 1 inside the comfortable range, decaying to 0 at hitMax. The decay is
 * quadratic — slow at first, steep near the ceiling — so a routine power
 * follow around the table keeps most of its value (going longer for a bigger
 * window is often the BETTER play), while monster sideways routes from
 * near-straight hits still die.
 */
export function powerFactor(hitDist: number, skill: SkillProfile): number {
  if (hitDist <= skill.hitComfort) return 1;
  if (hitDist >= skill.hitMax) return 0;
  const t = (hitDist - skill.hitComfort) / (skill.hitMax - skill.hitComfort);
  return 1 - t * t;
}

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26, max error ~1.5e-7.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Probability of potting the shot described by `g` into `pocket`.
 *
 * Model: the shooter's aim direction error is N(0, aimSigma^2). The error is
 * amplified by cue-ball travel (dCueGhost) and by cut thinness (1/cos cut)
 * into an object-ball direction error, which must stay within the angular
 * half-width of the pocket as seen from the ball.
 */
export function potProbability(g: ShotGeometry, pocket: Pocket, skill: SkillProfile): number {
  if (g.cut >= skill.maxCut) return 0;
  if (g.cut >= skill.comfortCut && g.dCueGhost > skill.thinCutMaxDist) return 0;
  const dev = approachDeviation(g.aim, pocket);
  if (dev >= effectiveAcceptance(pocket, g.dBallPocket)) return 0;
  const wEff = pocket.halfWidth * Math.pow(Math.cos(dev), 0.7);
  const allowedObError = Math.atan(wEff / Math.max(g.dBallPocket, 2 * BALL_R));
  const amplification = Math.max(g.dCueGhost, 2 * BALL_R) / (2 * BALL_R * Math.cos(g.cut));
  // Cuts past the sweet spot (~30 deg) get gradually harder beyond what the
  // geometric 1/cos amplification gives: contact-point precision drops off.
  const cutEase = 1 + skill.cutGrowth * Math.max(0, g.cut - skill.cutSweetMax);
  const obSigma = Math.hypot(skill.aimSigma * amplification * cutEase, skill.throwSigma);
  return erf(allowedObError / (obSigma * Math.SQRT2));
}

/**
 * Std dev of the cue ball's TABLE-FRAME departure direction induced by the
 * contact error, radians. With aim error e the impact line rotates by
 * eta = A*e (A = the cue-travel amplification), the cut changes by e - eta,
 * and the departure angle off the impact line changes by a'(cut) per unit of
 * cut, where a(c) = atan(tan c / k) and k is the signed roll share. Total:
 *
 *   d(psi) = a'(c) * e + (1 - a'(c)) * eta
 *
 * For a rolling follow a'(c) = 1 exactly at c = atan(sqrt(2/7)) ~ 28 deg —
 * the NATURAL ANGLE: the amplified term vanishes and the carom direction
 * error collapses to the bare aim error. That is the 30-degree-rule plateau,
 * and why the 15-30 deg window is the sweet spot for moving the cue ball.
 * Stun (a' = 0) carries the full amplified error; draw (a' < 0) more than
 * that; a near-straight follow (a' = 3.5) is twitchy in the other direction.
 *
 * Errors large enough to miss the pot don't count (those branches score 0
 * through the pot anyway), so the underlying error is capped at what the
 * pocket window admits.
 */
export function caromDirSigma(
  g: ShotGeometry,
  type: ShotType,
  pocket: Pocket,
  skill: SkillProfile,
): number {
  const k = signedRollShare(type);
  if (type === 'stop') return 0;
  const u = Math.tan(g.cut);
  // a'(c) = d/dc atan(tan c / k) = k (1+u^2) / (k^2 + u^2); stun: a' = 0.
  const aPrime = k === 0 ? 0 : (k * (1 + u * u)) / (k * k + u * u);
  const A = Math.max(g.dCueGhost, 2 * BALL_R) / (2 * BALL_R * Math.cos(g.cut));
  // Pot-conditional cap: an impact-line error beyond the pocket's angular
  // window is a miss, not a position error. Truncated-normal std ~ w/sqrt(3).
  const dev = approachDeviation(g.aim, pocket);
  const wEff = pocket.halfWidth * Math.pow(Math.cos(Math.min(dev, 1.4)), 0.7);
  const allowed = Math.atan(wEff / Math.max(g.dBallPocket, 2 * BALL_R));
  const etaRaw = A * skill.aimSigma;
  const eps = skill.aimSigma * Math.min(1, allowed / Math.sqrt(3) / Math.max(etaRaw, 1e-9));
  return Math.abs(aPrime + (1 - aPrime) * A) * eps;
}

/**
 * Reliability of the backspin action when the departure line meets a cushion
 * early: draw needs room for the spin to take before the rail, or the
 * idealized instant-bend path is no longer what happens. 1 for other types
 * and for routes that never reach a rail.
 */
export function drawRailFactor(
  type: ShotType,
  firstRailDist: number | null,
  skill: SkillProfile,
): number {
  if (firstRailDist === null) return 1;
  if (type !== 'draw' && type !== 'lowTouch') return 1;
  const t = Math.min(1, firstRailDist / skill.drawRailRoom);
  return type === 'draw' ? 0.65 + 0.35 * t : 0.85 + 0.15 * t;
}

/**
 * Execution reliability of a position route: the shot type's clean-action
 * probability, compounded by distance for draw (a long draw needs a much
 * harder stroke to keep its backspin) — and EASED below ~1 m, where keeping
 * the backspin is routine (drawShortEase): on an easy short shot, maximum
 * draw for a closer landing is a realistic, aggressive play.
 */
export function routeReliability(
  type: ShotType,
  shotDist: number,
  skill: SkillProfile,
): number {
  let f = shotDistFactor(type, shotDist, skill);
  if (type === 'draw' && shotDist < skill.thinCutMaxDist) {
    f = Math.max(skill.drawShortEase, shotDist / skill.thinCutMaxDist);
  }
  return Math.pow(skill.typeReliability[type], f);
}

/**
 * Execution cost for rigid multi-rail follow routes from near-straight cuts:
 * with little cut angle, the cue ball mostly owns one narrow aim-line path,
 * so asking it to run multiple cushions is much more sensitive than a normal
 * one-rail follow or a fuller natural-angle route.
 */
export function railRouteFactor(
  type: ShotType,
  cut: number,
  rails: number,
  skill: SkillProfile,
): number {
  if (type !== 'follow' || rails <= 1 || cut >= skill.straightFollowMultiRailCut) {
    return 1;
  }
  return skill.straightFollowMultiRailReliability ** (rails - 1);
}

/**
 * Route ease at a chosen travel: the type's execution reliability, the
 * hit-power price the travel demands at this cut, and draw rail-room (see
 * CONTEXT.md: Route). This is the factor that prices a position route's
 * P(reach the next zone) on the effective scale (zone value x ease), and it is
 * 0 below the pocket-pace minimum travel (the cue ball cannot travel less and
 * still drive the object ball home with margin). The single source for what
 * the route search (route.ts) and the onward-control gate (zone.ts) each
 * computed inline three times. `rails` and `firstRailDist` come from the
 * caller's path trace: the segment index and first-segment length on a locus
 * walk, the total rail count and first-rail arc length on an exact-curve walk.
 */
export function routeEase(
  g: ShotGeometry,
  type: ShotType,
  travel: number,
  rails: number,
  firstRailDist: number | null,
  skill: SkillProfile,
): number {
  if (travel < minCueTravel(g, type)) return 0;
  const railFac = rails === 0 ? 1 : drawRailFactor(type, firstRailDist, skill);
  return (
    routeReliability(type, g.dCueGhost, skill) *
    railFac *
    railRouteFactor(type, g.cut, rails, skill) *
    powerFactor(hitDistance(g, type, travel), skill)
  );
}

/**
 * Difficulty multiplier from cue-to-ball distance at the moment of the shot:
 * a full draw past ~1 m needs a much harder stroke to keep its backspin, so
 * both its speed and direction errors grow. Other types are unaffected.
 */
export function shotDistFactor(
  type: ShotType,
  shotDist: number,
  skill: SkillProfile,
): number {
  if (type !== 'draw' || shotDist <= skill.thinCutMaxDist) return 1;
  return 1 + skill.drawDistFactor * ((shotDist - skill.thinCutMaxDist) / skill.thinCutMaxDist);
}

/**
 * Effective distance-error sigma for a position route: relative error on the
 * intended travel, damped by each cushion (brake), plus per-cushion noise.
 * `shotDist` is the cue-to-object-ball distance of the shot itself.
 */
export function distanceSigma(
  type: ShotType,
  travel: number,
  rails: number,
  skill: SkillProfile,
  shotDist = 0,
): number {
  const base =
    (skill.speedSigma[type] * travel + skill.speedSigmaFloor[type]) *
      shotDistFactor(type, shotDist, skill) +
    (type === 'stop' ? skill.stopDrift * shotDist : 0);
  return base * Math.pow(skill.railBrake, rails) + rails * skill.railNoise;
}

export function directionSigma(
  type: ShotType,
  rails: number,
  skill: SkillProfile,
  shotDist = 0,
  /** Shot geometry + pocket: adds the carom-direction term (caromDirSigma). */
  carom?: { g: ShotGeometry; pocket: Pocket },
  /** Played from ball in hand: the spotted, rehearsed carom (handDirEase). */
  fromHand = false,
): number {
  const stroke = skill.dirSigma[type] * shotDistFactor(type, shotDist, skill);
  const base = carom
    ? Math.hypot(stroke, caromDirSigma(carom.g, type, carom.pocket, skill))
    : stroke;
  return base * (fromHand ? skill.handDirEase : 1) + rails * skill.railDirSigma;
}

/**
 * Deterministic Gauss-Hermite quadrature for E[f(X)] with X ~ N(0, 1):
 * sample at offset*sigma with the paired weight.
 */
export const DIST_NODES = [-2.857, -1.356, 0, 1.356, 2.857];
export const DIST_WEIGHTS = [0.0113, 0.2221, 0.5333, 0.2221, 0.0113];
export const DIR_NODES = [-1.732, 0, 1.732];
export const DIR_WEIGHTS = [0.1667, 0.6667, 0.1667];

export interface PerturbSample {
  dDist: number; // in sigmas (already scaled by node)
  dDir: number;
  weight: number;
}

export function perturbSamples(distSigma: number, dirSigma: number): PerturbSample[] {
  const out: PerturbSample[] = [];
  for (let i = 0; i < DIST_NODES.length; i++) {
    for (let j = 0; j < DIR_NODES.length; j++) {
      out.push({
        dDist: DIST_NODES[i] * distSigma,
        dDir: DIR_NODES[j] * dirSigma,
        weight: DIST_WEIGHTS[i] * DIR_WEIGHTS[j],
      });
    }
  }
  return out;
}

export type { Vec };
