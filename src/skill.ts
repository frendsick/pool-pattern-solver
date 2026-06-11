// Skill Profile (see CONTEXT.md): every probability in the solver comes from
// this parameter object, so a skill slider later is a pure profile swap
// (ADR-0002). v1 ships one fixed intermediate profile.

import { Vec } from './geometry';
import { BALL_R, Pocket } from './table';
import { ShotGeometry, ShotType, approachDeviation } from './shots';

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
  /** Max cue-to-ball distance for cuts beyond comfortCut, inches. */
  thinCutMaxDist: number;
  /** Relative speed (travel distance) error per shot type. */
  speedSigma: Record<ShotType, number>;
  /** Floor on distance error, inches. */
  speedSigmaFloor: number;
  /** Departure direction error per shot type, radians. */
  dirSigma: Record<ShotType, number>;
  /** Extra departure-direction error per cushion contact, radians. */
  railDirSigma: number;
  /**
   * Draw needs more power the longer the shot: extra error multiplier per
   * thinCutMaxDist (~1 m) of cue-to-ball distance beyond the first.
   */
  drawDistFactor: number;
  /** Distance error damping per cushion (cushions act as brakes). */
  railBrake: number;
  /** Extra distance noise per cushion, inches. */
  railNoise: number;
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
}

const deg = (d: number) => (d * Math.PI) / 180;

export const INTERMEDIATE: SkillProfile = {
  aimSigma: 0.003,
  throwSigma: 0.012,
  maxCut: deg(60),
  comfortCut: deg(48),
  thinCutMaxDist: 39.4, // 1 m
  speedSigma: { stop: 0.04, follow: 0.1, lowTouch: 0.11, stun: 0.13, draw: 0.18 },
  speedSigmaFloor: 1.5,
  dirSigma: {
    stop: deg(0.8),
    follow: deg(1.2),
    lowTouch: deg(1.4),
    stun: deg(1.6),
    draw: deg(2.2),
  },
  railDirSigma: deg(0.9),
  drawDistFactor: 0.9,
  railBrake: 0.75,
  railNoise: 1.0,
  positionTravelScale: 45,
  typeReliability: { stop: 0.99, follow: 0.98, lowTouch: 0.96, stun: 0.93, draw: 0.85 },
};

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
  if (dev >= pocket.acceptance) return 0;
  const wEff = pocket.halfWidth * Math.pow(Math.cos(dev), 0.7);
  const allowedObError = Math.atan(wEff / Math.max(g.dBallPocket, 2 * BALL_R));
  const amplification = Math.max(g.dCueGhost, 2 * BALL_R) / (2 * BALL_R * Math.cos(g.cut));
  const obSigma = Math.hypot(skill.aimSigma * amplification, skill.throwSigma);
  return erf(allowedObError / (obSigma * Math.SQRT2));
}

/**
 * Execution reliability of a position route: the shot type's clean-action
 * probability, compounded by distance for draw (a long draw needs a much
 * harder stroke to keep its backspin).
 */
export function routeReliability(
  type: ShotType,
  shotDist: number,
  skill: SkillProfile,
): number {
  return Math.pow(skill.typeReliability[type], shotDistFactor(type, shotDist, skill));
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
    (skill.speedSigma[type] * travel + skill.speedSigmaFloor) *
    shotDistFactor(type, shotDist, skill);
  return base * Math.pow(skill.railBrake, rails) + rails * skill.railNoise;
}

export function directionSigma(
  type: ShotType,
  rails: number,
  skill: SkillProfile,
  shotDist = 0,
): number {
  return (
    skill.dirSigma[type] * shotDistFactor(type, shotDist, skill) +
    rails * skill.railDirSigma
  );
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
