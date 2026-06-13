// Builds the Scene for one step of a Pattern: shared by the app (main.ts)
// and the snapshot tool (scripts/snapshot.ts).

import { Vec } from './geometry';
import { Layout, POCKETS } from './table';
import { SkillProfile } from './skill';
import { Pattern } from './solver';
import { zoneContext, zonePeak, zonePolygons } from './zone';
import { Scene } from './render';

function polygonArea(polys: Vec[][]): number {
  let total = 0;
  for (const poly of polys) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      a += p.x * q.y - q.x * p.y;
    }
    total += Math.abs(a) / 2;
  }
  return total;
}

/**
 * Steps: 0 = bare layout (no cue ball — visualize your own pattern first),
 * 1 = overview (solver's cue placement + faint paths), 2.. = shots 1..n.
 */
export function sceneForStep(
  layout: Layout,
  pattern: Pattern,
  s: number,
  skill: SkillProfile,
): Scene {
  const shots = pattern.shots;
  if (s === 0) {
    return {
      balls: layout.balls,
      zone: [],
      altZones: [],
      shot: null,
      ghostPaths: [],
      cue: null,
    };
  }
  if (s === 1) {
    return {
      balls: layout.balls,
      zone: [],
      altZones: [],
      shot: null,
      ghostPaths: shots.flatMap((sh) => (sh.path ? [sh.path] : [])),
      cue: shots[0].cuePos,
    };
  }
  const k = s - 1; // shot number, 1-based
  const shot = shots[k - 1];
  const next = shots[k] ?? null;
  let zone: Vec[][] = [];
  const altZones: Vec[][] = [];
  // The shot already carries the resolved Position Zone the route was scored
  // against (solver.ts resolveShotZones): the chosen-pocket zone of the
  // following ball, gated by its backward value surface down to the 9. Drawing
  // it — rather than rebuilding it here — is what guarantees the window the
  // user sees is the window the route was scored against.
  if (next && shot.zone) {
    const primary = shot.zone;
    // The window's quality bar is capped to what the chosen route's landing
    // stretch can reach (windowRef): the drawn window is the stretch the
    // route is playing for, and the planned landing sits inside it.
    const cap = shot.windowRef ?? Infinity;
    zone = zonePolygons(primary, skill, 0, 85, cap);
    // The best other pocket expands the window, but as a second choice held
    // to the primary pocket's quality bar; showing every pocket's zone would
    // bury the primary one in noise. The alt pockets reuse the primary zone's
    // own obstacles and gate, so they are gated identically.
    const bar = Math.min(zonePeak(primary, skill), cap);
    let bestAlt: Vec[][] | null = null;
    for (const p of POCKETS) {
      if (p.id === next.pocket.id) continue;
      const polys = zonePolygons(
        zoneContext(next.ball.pos, p, primary.obstacles, [], primary.nextValue),
        skill, bar, 85, cap,
      );
      if (polys.length > 0 && (!bestAlt || polygonArea(polys) > polygonArea(bestAlt))) {
        bestAlt = polys;
      }
    }
    if (bestAlt) altZones.push(...bestAlt);
  }
  return {
    balls: layout.balls.slice(k - 1),
    zone,
    altZones,
    shot: {
      cuePos: shot.cuePos,
      ghost: shot.ghost,
      ballPos: shot.ball.pos,
      pocketTarget: shot.pocket.target,
      path: shot.path,
      landing: shot.landing,
    },
    ghostPaths: [],
    cue: shot.cuePos,
  };
}
