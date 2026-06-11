// 9-foot table, WPA playing surface 100" x 50". Origin at the bottom-left
// cushion nose; x runs along the long rail, y along the short rail.

import { Vec, vec, norm } from './geometry';

export const TABLE_W = 100;
export const TABLE_H = 50;
export const BALL_R = 1.125;

export type PocketId = 'BL' | 'BR' | 'TL' | 'TR' | 'BS' | 'TS';

export interface Pocket {
  id: PocketId;
  /** Aiming target for the object ball (mouth of the pocket). */
  target: Vec;
  /** Unit vector pointing from the table into the pocket. */
  facing: Vec;
  /** Half-width of the effective target at the mouth, inches. */
  halfWidth: number;
  /** Max deviation of the ball's arrival direction from `facing` (radians). */
  acceptance: number;
  /** Cue ball paths passing this close to the target are a scratch risk. */
  captureRadius: number;
  label: string;
}

const corner = (id: PocketId, x: number, y: number, label: string): Pocket => ({
  id,
  target: vec(x, y),
  facing: norm(vec(x === 0 ? -1 : 1, y === 0 ? -1 : 1)),
  halfWidth: 2.1,
  acceptance: (52 * Math.PI) / 180,
  captureRadius: 3.0,
  label,
});

const side = (id: PocketId, x: number, y: number, label: string): Pocket => ({
  id,
  target: vec(x, y),
  facing: norm(vec(0, y === 0 ? -1 : 1)),
  halfWidth: 1.7,
  acceptance: (38 * Math.PI) / 180,
  captureRadius: 2.6,
  label,
});

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
