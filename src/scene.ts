// Builds the Scene for one step of a Pattern: shared by the app (main.ts)
// and the snapshot tool (scripts/snapshot.ts).

import { Vec } from './geometry';
import { Layout, POCKETS } from './table';
import { SkillProfile } from './skill';
import { Pattern } from './solver';
import { zoneContext, zonePeak, zonePolygon } from './zone';
import { Scene } from './render';

function polygonArea(poly: Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
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
      zone: null,
      altZones: [],
      shot: null,
      ghostPaths: [],
      cue: null,
    };
  }
  if (s === 1) {
    return {
      balls: layout.balls,
      zone: null,
      altZones: [],
      shot: null,
      ghostPaths: shots.flatMap((sh) => (sh.path ? [sh.path] : [])),
      cue: shots[0].cuePos,
    };
  }
  const k = s - 1; // shot number, 1-based
  const shot = shots[k - 1];
  const next = shots[k] ?? null;
  let zone = null;
  const altZones = [];
  if (next) {
    const later = layout.balls.slice(k + 1).map((b) => b.pos);
    // Zones of the ball after `next`: the displayed zone keeps only cue
    // positions from which the cue ball can be moved on toward one of them.
    const after = layout.balls[k + 1] ?? null;
    const afterObstacles = layout.balls.slice(k + 2).map((b) => b.pos);
    const nextZones = after
      ? POCKETS.map((p) => zoneContext(after.pos, p, afterObstacles)).filter(
          (z) => z.ballPathClear,
        )
      : [];
    const primary = zoneContext(next.ball.pos, next.pocket, later, nextZones);
    // The window's quality bar is capped to what the chosen route's landing
    // stretch can reach (windowRef): the drawn window is the stretch the
    // route is playing for, and the planned landing sits inside it.
    const cap = shot.windowRef ?? Infinity;
    zone = zonePolygon(primary, skill, 0, 85, cap);
    // The best other pocket expands the window, but as a second choice held
    // to the primary pocket's quality bar; showing every pocket's zone would
    // bury the primary one in noise.
    const bar = Math.min(zonePeak(primary, skill), cap);
    let bestAlt: Vec[] | null = null;
    for (const p of POCKETS) {
      if (p.id === next.pocket.id) continue;
      const poly = zonePolygon(
        zoneContext(next.ball.pos, p, later, nextZones), skill, bar, 85, cap,
      );
      if (poly.length >= 3 && (!bestAlt || polygonArea(poly) > polygonArea(bestAlt))) {
        bestAlt = poly;
      }
    }
    if (bestAlt) altZones.push(bestAlt);
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
