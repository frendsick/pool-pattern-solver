// Ball-in-hand placement (see CONTEXT.md: Ball in Hand). Generates seed nodes
// for the beam search: an angle x distance grid per open pocket, plus
// shotline-aligned placements whose carom path runs along the next ball's
// shot line (alignedCuts). The solver's forward search starts from these.

import {
  Vec,
  add,
  scale,
  norm,
  rotate,
  sub,
  angleBetween,
  dist,
} from './geometry';
import { Layout, Pocket, POCKETS } from './table';
import {
  ShotType,
  shotGeometry,
  tracePath,
  caromLocus,
} from './shots';
import { SkillProfile } from './skill';
import { NextValueFn, zoneContext, zoneValue } from './zone';
import { ZoneTarget, MAX_ROUTE } from './route';
import type { Node } from './solver';

/**
 * A carom leg counts as running along the next shot line when it is within
 * this many degrees of parallel and passes this close to the line's spine.
 */
const ALIGN_MAX_DEG = 14;
const ALIGN_MAX_OFF = 10;

/**
 * Signed placement angles (degrees off straight-in; the magnitude is the cut,
 * the sign picks the side of the aim line) whose carom path off this pocket
 * runs ALONG the next ball's shot line — directly or off a cushion that folds
 * the path back down the line. From such a route the landing spread slides
 * along the window instead of across it, and with ball in hand the placement
 * can be engineered for it exactly: the intended carom path is super accurate
 * when the cue ball is spotted by hand. The fixed seed grid quantizes the cut
 * to 10-15 degree steps and usually misses these, so they are solved for:
 * scan the signed cut, trace each type's landing locus, and keep the cuts
 * whose path has a leg most parallel to and closest to a next shot line.
 */
function alignedCuts(
  ball: Vec,
  pocket: Pocket,
  ghost: Vec,
  aim: Vec,
  others: Vec[],
  targets: ZoneTarget[],
  skill: SkillProfile,
): number[] {
  if (targets.length === 0) return [];
  const aimBack = scale(aim, -1);
  const spines = targets.map((t) => {
    const u = norm(sub(t.zc.ball, t.zc.pocket.target));
    return { u, anchor: add(t.zc.ball, scale(u, 12)) };
  });
  const maxDeg = Math.floor((skill.maxCut * 180) / Math.PI) - 2;
  const found: { aDeg: number; score: number }[] = [];
  for (let mag = 4; mag <= maxDeg; mag++) {
    for (const sign of [-1, 1]) {
      const aDeg = sign * mag;
      const cue = add(ghost, scale(rotate(aimBack, (aDeg * Math.PI) / 180), 8));
      const g = shotGeometry(cue, ball, pocket);
      if (!g) continue;
      let best = Infinity;
      for (const type of ['follow', 'stun', 'lowTouch', 'draw'] as ShotType[]) {
        const locus = caromLocus(g, type);
        if (!locus) continue;
        const tr = tracePath(g.ghost, locus.dir, MAX_ROUTE * locus.eta, others, 3);
        for (let i = 0; i + 1 < tr.points.length; i++) {
          const a = tr.points[i];
          const segLen = dist(a, tr.points[i + 1]);
          if (segLen < 6) continue;
          const d = scale(sub(tr.points[i + 1], a), 1 / segLen);
          for (const s of spines) {
            const ang = angleBetween(d, s.u);
            const deg = (Math.min(ang, Math.PI - ang) * 180) / Math.PI;
            if (deg > ALIGN_MAX_DEG) continue;
            const rel = sub(s.anchor, a);
            const along = rel.x * d.x + rel.y * d.y;
            if (along < -8 || along > segLen + 20) continue;
            const off = Math.abs(rel.x * d.y - rel.y * d.x);
            if (off > ALIGN_MAX_OFF) continue;
            best = Math.min(best, deg + 1.5 * off);
          }
        }
      }
      if (best < Infinity) found.push({ aDeg, score: best });
    }
  }
  found.sort((a, b) => a.score - b.score);
  const picked: number[] = [];
  for (const f of found) {
    if (picked.some((p) => Math.abs(p - f.aDeg) < 3)) continue;
    picked.push(f.aDeg);
    if (picked.length >= 4) break;
  }
  return picked;
}

export function initialNodes(
  layout: Layout,
  skill: SkillProfile,
  nextValue: NextValueFn | undefined,
  nextTargets: ZoneTarget[] = [],
): Node[] {
  const first = layout.balls[0];
  const others = layout.balls.slice(1).map((b) => b.pos);
  const nodes: Node[] = [];
  const angles = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
  const dists = [8, 10, 16, 24, 34];

  for (const pocket of POCKETS) {
    const zc = zoneContext(first.pos, pocket, others);
    if (!zc.ballPathClear) continue;
    const zcGated = nextValue
      ? zoneContext(first.pos, pocket, others, [], nextValue)
      : zc;
    const aim = norm(sub(pocket.target, first.pos));
    const aimBack = scale(aim, -1);
    const ghost = add(first.pos, scale(aimBack, 2 * 1.125));
    const seed = (aDeg: number, d: number): Node | null => {
      const c = add(ghost, scale(rotate(aimBack, (aDeg * Math.PI) / 180), d));
      const v = zoneValue(c, zc, skill);
      if (v < 0.35) return null;
      if (zcGated !== zc && zoneValue(c, zcGated, skill) <= 0) return null;
      const g = shotGeometry(c, first.pos, pocket);
      if (!g) return null;
      return {
        score: v,
        sortKey: v,
        done: [],
        pending: { ball: first, pocket, cuePos: c, g, potProb: v },
      };
    };
    const pocketNodes: Node[] = [];
    for (const aDeg of angles) {
      for (const d of dists) {
        const n = seed(aDeg, d);
        if (n) pocketNodes.push(n);
      }
    }
    pocketNodes.sort((a, b) => b.score - a.score);
    nodes.push(...pocketNodes.slice(0, 12));

    const alignedNodes: Node[] = [];
    for (const aDeg of alignedCuts(first.pos, pocket, ghost, aim, others, nextTargets, skill)) {
      if (angles.some((a) => Math.abs(a - aDeg) < 2)) continue;
      for (const d of dists) {
        const n = seed(aDeg, d);
        if (n) alignedNodes.push(n);
      }
    }
    alignedNodes.sort((a, b) => b.score - a.score);
    nodes.push(...alignedNodes.slice(0, 8));
  }
  return nodes;
}
