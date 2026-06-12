// Backward value surfaces — the "calculate from the 9 backwards" pass. For
// each ball k of a Layout, V_k rasterizes over the table how good a cue-ball
// position is for SHOOTING ball k counting everything that still has to
// happen: pot of ball k, discounted by onward control measured against
// V_{k+1}, which is itself gated by V_{k+2}, down to the pot-only surface of
// the 9. Built by backward induction once per Layout; the route search, the
// landing bars and the rendered windows all gate against the same surfaces
// (ZoneContext.nextValue), so the window drawn for the 7 already excludes
// spots from which the 8 is pottable but only into 8-on-9 dead positions.
//
// Each surface is normalized to its own peak before use as a gate target:
// chained values are products and shrink with rack depth, so a fixed
// absolute bar (CONTROL_SAT) would drown the signal on long racks. The
// normalized gate keeps the ZONE_RELATIVE philosophy — "can the cue ball
// reach a spot near the BEST still available for the rest of the rack".
//
// Surfaces depend only on the Layout and the forced ball order, never on the
// pattern being searched: every beam node, every quadrature sample and the
// renderer share them via the per-layout cache (surfacesForLayout).

import { Vec } from './geometry';
import { Ball, Layout, MIN_X, MAX_X, MIN_Y, MAX_Y, POCKETS } from './table';
import { SkillProfile } from './skill';
import { NextValueFn, zoneContext, zoneValue } from './zone';

/**
 * Grid pitch, inches — matches scanFan's radial step, so zone features at
 * that scale (rail band, clearance rings, ball shadows) stay resolved.
 * Bilinear interpolation smears hard zeros by under a cell; the error only
 * enters at gate depth >= 2, where the future is fuzzy anyway — the
 * immediate next zone is always measured with exact zoneValue.
 */
const GRID_STEP = 1.5;

export interface ValueSurface {
  /** Normalized 0..1 lookup; 0 off the table. */
  at: NextValueFn;
  /** Peak RAW value over the grid; 0 means the ball is pottable from nowhere. */
  peak: number;
}

function lookup(
  grid: Float32Array,
  nx: number,
  ny: number,
  sx: number,
  sy: number,
): NextValueFn {
  return (p: Vec): number => {
    if (p.x < MIN_X || p.x > MAX_X || p.y < MIN_Y || p.y > MAX_Y) return 0;
    const gx = Math.min((p.x - MIN_X) / sx, nx - 1 - 1e-6);
    const gy = Math.min((p.y - MIN_Y) / sy, ny - 1 - 1e-6);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const i = y0 * nx + x0;
    const top = grid[i] * (1 - fx) + grid[i + 1] * fx;
    const bot = grid[i + nx] * (1 - fx) + grid[i + nx + 1] * fx;
    return top * (1 - fy) + bot * fy;
  };
}

function buildSurface(
  ball: Ball,
  obstacles: Vec[],
  next: NextValueFn | undefined,
  skill: SkillProfile,
): ValueSurface {
  const spanX = MAX_X - MIN_X;
  const spanY = MAX_Y - MIN_Y;
  const nx = Math.ceil(spanX / GRID_STEP) + 1;
  const ny = Math.ceil(spanY / GRID_STEP) + 1;
  const sx = spanX / (nx - 1);
  const sy = spanY / (ny - 1);
  // One gated context per open pocket, shared by every cell: onward control
  // is memoized per context (cachedOnwardControl), so the cells repay it.
  const zones = POCKETS.map((p) =>
    zoneContext(ball.pos, p, obstacles, [], next),
  ).filter((z) => z.ballPathClear);
  const grid = new Float32Array(nx * ny);
  let peak = 0;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const c = { x: MIN_X + ix * sx, y: MIN_Y + iy * sy };
      let v = 0;
      for (const z of zones) {
        const zv = zoneValue(c, z, skill);
        if (zv > v) v = zv;
      }
      grid[iy * nx + ix] = v;
      if (v > peak) peak = v;
    }
  }
  if (peak > 0) for (let j = 0; j < grid.length; j++) grid[j] /= peak;
  return { at: lookup(grid, nx, ny, sx, sy), peak };
}

/**
 * Surfaces V_1..V_{n-1}, built last ball first. surfaces[i] gates the zone
 * of ball i-1 (and the ball-in-hand placement, for i = 1); index 0 is never
 * a gate target and stays null. A dead surface (peak 0) gates the level
 * above as "no gate" rather than zeroing it — the failure then surfaces at
 * the dead ball's own zoneTargets, exactly where it does today.
 */
export function buildSurfaces(
  balls: Ball[],
  skill: SkillProfile,
): (ValueSurface | null)[] {
  const out: (ValueSurface | null)[] = balls.map(() => null);
  let next: ValueSurface | null = null;
  for (let i = balls.length - 1; i >= 1; i--) {
    const obstacles = balls.slice(i + 1).map((b) => b.pos);
    const s = buildSurface(
      balls[i],
      obstacles,
      next && next.peak > 0 ? next.at : undefined,
      skill,
    );
    out[i] = s;
    next = s;
  }
  return out;
}

/** The gate the zone of ball i-1 should use, or undefined for "no gate". */
export function gateFor(
  surfaces: (ValueSurface | null)[],
  i: number,
): NextValueFn | undefined {
  const s = surfaces[i] ?? null;
  return s && s.peak > 0 ? s.at : undefined;
}

const cache = new WeakMap<
  Layout,
  { skill: SkillProfile; surfaces: (ValueSurface | null)[] }
>();

/** Per-layout surface cache: solver and renderer share one backward pass. */
export function surfacesForLayout(
  layout: Layout,
  skill: SkillProfile,
): (ValueSurface | null)[] {
  const hit = cache.get(layout);
  if (hit && hit.skill === skill) return hit.surfaces;
  const surfaces = buildSurfaces(layout.balls, skill);
  cache.set(layout, { skill, surfaces });
  return surfaces;
}
