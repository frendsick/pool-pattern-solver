// 9-foot table, WPA playing surface 100" x 50". Origin at the bottom-left
// cushion nose; x runs along the long rail, y along the short rail.

import { Vec, vec, norm } from './geometry';

export const TABLE_W = 100;
export const TABLE_H = 50;
export const BALL_R = 1.125;
/** Physical distance between corner jaw noses, shared with the renderer. */
export const CORNER_MOUTH = 4.5;
/** Minimum cue-center distance from an obstacle ball's center. */
export const CUE_OBSTACLE_CLEARANCE = 2 * BALL_R + 0.05;

export type PocketId = 'BL' | 'BR' | 'TL' | 'TR' | 'BS' | 'TS';

export interface Pocket {
  id: PocketId;
  /** Center of the physical pocket mouth, used for aiming. */
  target: Vec;
  /** Center of the heuristic scratch capture disk, independent of aim. */
  captureCenter: Vec;
  /** Unit vector pointing from the table into the pocket. */
  facing: Vec;
  /** Half-width of the effective target at the mouth, inches. */
  halfWidth: number;
  /** Max deviation of the ball's arrival direction from `facing` (radians). */
  acceptance: number;
  /** Cue ball paths passing this close to captureCenter are a scratch risk. */
  captureRadius: number;
  label: string;
}

const corner = (id: PocketId, x: number, y: number, label: string): Pocket => ({
  id,
  captureCenter: vec(x, y),
  target: vec(
    x + (x === 0 ? 1 : -1) * CORNER_MOUTH / (2 * Math.SQRT2),
    y + (y === 0 ? 1 : -1) * CORNER_MOUTH / (2 * Math.SQRT2),
  ),
  facing: norm(vec(x === 0 ? -1 : 1, y === 0 ? -1 : 1)),
  halfWidth: 2.1,
  acceptance: (52 * Math.PI) / 180,
  captureRadius: 3.0,
  label,
});

const side = (id: PocketId, x: number, y: number, label: string): Pocket => ({
  id,
  captureCenter: vec(x, y),
  target: vec(x, y),
  facing: norm(vec(0, y === 0 ? -1 : 1)),
  halfWidth: 1.7,
  acceptance: (38 * Math.PI) / 180,
  captureRadius: 2.6,
  label,
});

/**
 * The acceptance cone is a far-field property: at distance, an approach
 * steeper than `acceptance` meets the jaw facings and stays out. Up close the
 * cone logic stops applying — the visible mouth itself is the target, and a
 * ball sitting near the jaws can be cut in at angles the cone forbids — so
 * the effective cone widens toward ACCEPTANCE_NEAR as the ball approaches,
 * fading back to the nominal cone over ~JAW_RANGE inches.
 */
const ACCEPTANCE_NEAR = (75 * Math.PI) / 180;
// 9": a ball ~8.5" out at ~50 deg off the facing still drops (image #29 —
// the hanging 7 by the bottom side pocket is "the easy stop shot"), while
// the same approach 30" out keeps meeting the jaw facings.
const JAW_RANGE = 9;

export function effectiveAcceptance(p: Pocket, dBallPocket: number): number {
  return (
    p.acceptance +
    (ACCEPTANCE_NEAR - p.acceptance) * Math.exp(-dBallPocket / JAW_RANGE)
  );
}

export const POCKETS: Pocket[] = [
  corner('BL', 0, 0, 'bottom-left corner'),
  corner('BR', TABLE_W, 0, 'bottom-right corner'),
  corner('TL', 0, TABLE_H, 'top-left corner'),
  corner('TR', TABLE_W, TABLE_H, 'top-right corner'),
  side('BS', TABLE_W / 2, 0, 'bottom side pocket'),
  side('TS', TABLE_W / 2, TABLE_H, 'top side pocket'),
];

export const pocketById = (id: PocketId): Pocket =>
  POCKETS.find((p) => p.id === id)!;

/**
 * Foot spot: long-axis centerline, a quarter of the table length off a short
 * rail. The 9 racks here and, on most breaks, rests on or near it. By symmetry
 * either short rail is equivalent; we pick the right-hand one.
 */
export const FOOT_SPOT = vec((TABLE_W * 3) / 4, TABLE_H / 2);

/** Ball-center bounds: the cue/object ball center must stay inside these. */
export const MIN_X = BALL_R;
export const MAX_X = TABLE_W - BALL_R;
export const MIN_Y = BALL_R;
export const MAX_Y = TABLE_H - BALL_R;

export const onTable = (p: Vec): boolean =>
  p.x >= MIN_X && p.x <= MAX_X && p.y >= MIN_Y && p.y <= MAX_Y;

export interface Ball {
  /** 9-ball number, e.g. 7, 8, 9. */
  num: number;
  pos: Vec;
}

export interface Layout {
  /** Remaining object balls, sorted ascending by number (forced 9-ball order). */
  balls: Ball[];
  seed: number;
}
