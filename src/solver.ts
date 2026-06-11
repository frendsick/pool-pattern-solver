// Pattern solver. A Pattern (see CONTEXT.md) fixes: the ball-in-hand cue
// placement, then per ball the pocket, the route (Shot Type + rails + travel)
// and the Position Zone targeted. Patterns are scored by Run-out Probability
// (ADR-0002): P(pot of shot 1) x product over transitions of E[next pot],
// where the expectation runs over a deterministic quadrature of speed and
// direction errors. Zone size, coming into the line, natural angles and
// cushion braking all enter through that expectation rather than weights.

import {
  Vec,
  add,
  scale,
  norm,
  rotate,
  sub,
  angleBetween,
  dist,
  distPointSegment,
} from './geometry';
import { Ball, Layout, Pocket, POCKETS } from './table';
import {
  ShotGeometry,
  ShotType,
  shotGeometry,
  departureDir,
  minCueTravel,
  tracePath,
} from './shots';
import {
  SkillProfile,
  distanceSigma,
  directionSigma,
  perturbSamples,
  routeReliability,
} from './skill';
import { ZoneContext, ZONE_FLOOR, ZONE_RELATIVE, zoneBar, zoneContext, zonePeak, zoneValue } from './zone';

export interface PlannedShot {
  ball: Ball;
  pocket: Pocket;
  cuePos: Vec;
  ghost: Vec;
  cutDeg: number;
  potProb: number;
  /** Route to the next shot; null for the final ball. */
  type: ShotType | null;
  path: Vec[] | null;
  landing: Vec | null;
  rails: number;
  travel: number;
  /** Expected pot probability of the NEXT shot over the landing spread. */
  eNext: number | null;
  /** Length of the intended path that lies inside the next zone, inches. */
  zoneLen: number | null;
  /** Angle between path at zone entry and the line of the next shot, deg. */
  entryDeg: number | null;
  explanation: string;
}

export interface Pattern {
  shots: PlannedShot[];
  score: number;
}

const BEAM = 40;
const EVAL_CAP = 130;
const MAX_ROUTE = 220;
const ZONE_VMIN = 0.15;
const WALK_STEP = 2.0;

interface PendingShot {
  ball: Ball;
  pocket: Pocket;
  cuePos: Vec;
  g: ShotGeometry;
  potProb: number;
}

interface Node {
  score: number;
  /**
   * Keep-it-simple tie-break (Dr. Dave #1): score discounted by a tiny
   * complexity term (shot type, rails, travel) so that near-equal patterns
   * resolve toward the simpler route. Never reported to the user.
   */
  sortKey: number;
  done: PlannedShot[];
  pending: PendingShot;
}

const TYPE_RANK: Record<ShotType, number> = {
  stop: 0,
  follow: 0.5,
  lowTouch: 0.8,
  stun: 1,
  draw: 2,
};

function complexityDiscount(type: ShotType, rails: number, travel: number): number {
  // Travel is a real cost (Dr. Dave #2: don't move more than needed), so it
  // weighs noticeably more than the cosmetic type/rail terms.
  return 1 - (TYPE_RANK[type] * 0.01 + rails * 0.004 + travel * 0.0005);
}

/**
 * Routes that skim a pocket mouth risk a scratch that the clean trace does
 * not see: penalize passes within SCRATCH_MARGIN of the capture radius.
 */
const SCRATCH_MARGIN = 4;

function pocketRisk(path: Vec[]): number {
  let worst = 1;
  for (const p of POCKETS) {
    let d = Infinity;
    for (let i = 0; i + 1 < path.length; i++) {
      d = Math.min(d, distPointSegment(p.target, path[i], path[i + 1]));
    }
    const clear = d - p.captureRadius;
    if (clear < SCRATCH_MARGIN) {
      worst = Math.min(worst, 0.35 + (0.65 * Math.max(0, clear)) / SCRATCH_MARGIN);
    }
  }
  return worst;
}

interface PathSample {
  s: number;
  p: Vec;
  rails: number;
  dirAt: Vec;
  v: number;
}

interface Interval {
  s0: number;
  s1: number;
  peakS: number;
  peakV: number;
  entryDir: Vec;
}

function samplePath(
  start: Vec,
  dir: Vec,
  obstacles: Vec[],
  zc: ZoneContext,
  skill: SkillProfile,
): PathSample[] {
  const tr = tracePath(start, dir, MAX_ROUTE, obstacles, 3);
  const out: PathSample[] = [];
  let s = 0;
  for (let i = 0; i + 1 < tr.points.length; i++) {
    const a = tr.points[i];
    const b = tr.points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-9) continue;
    const d = norm(sub(b, a));
    for (let t = i === 0 ? WALK_STEP : 0; t <= segLen; t += WALK_STEP) {
      const p = add(a, scale(d, t));
      out.push({ s: s + t, p, rails: i, dirAt: d, v: zoneValue(p, zc, skill) });
    }
    s += segLen;
  }
  return out;
}

function findIntervals(samples: PathSample[], vmin = ZONE_VMIN): Interval[] {
  const intervals: Interval[] = [];
  let cur: PathSample[] = [];
  const flush = () => {
    if (cur.length >= 2) {
      let peak = cur[0];
      for (const q of cur) if (q.v > peak.v) peak = q;
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
    if (q.v >= vmin) cur.push(q);
    else flush();
  }
  flush();
  intervals.sort((a, b) => (b.s1 - b.s0) * b.peakV - (a.s1 - a.s0) * a.peakV);
  return intervals.slice(0, 2);
}

function railsAtDistance(samples: PathSample[], s: number): number {
  let rails = 0;
  for (const q of samples) {
    if (q.s > s) break;
    rails = q.rails;
  }
  return rails;
}

function valueNear(samples: PathSample[], s: number): number {
  let best = 0;
  let bestD = Infinity;
  for (const q of samples) {
    const d = Math.abs(q.s - s);
    if (d < bestD) {
      bestD = d;
      best = q.v;
    }
  }
  return best;
}

/**
 * Expected pot probability of the next shot over the landing distribution of
 * this route — the Position Zone factor of the score. Exported for the
 * golden-scenario tests.
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
): number {
  const sigS = distanceSigma(type, travel, railsIntended, skill, shotDist);
  const sigD = directionSigma(type, railsIntended, skill, shotDist);
  let e = 0;
  for (const smp of perturbSamples(sigS, sigD)) {
    const dir = rotate(baseDir, smp.dDir);
    const t = Math.max(0.1, travel + smp.dDist);
    const tr = tracePath(start, dir, t, obstacles, 4);
    if (tr.outcome === 'scratch') continue;
    e += smp.weight * zoneValue(tr.end, zc, skill);
  }
  return e;
}

interface RouteCandidate {
  node: Node;
  zc: ZoneContext;
  nextPocket: Pocket;
  type: ShotType;
  dir: Vec;
  travel: number;
  rails: number;
  landing: Vec;
  zoneLen: number | null;
  entryDeg: number | null;
  proxy: number;
}

function stopDir(g: ShotGeometry): Vec {
  const t = g.tangent;
  if (Math.hypot(t.x, t.y) > 0.5) return t;
  return rotate(g.aim, Math.PI / 2);
}

/** Angle (deg) between a path direction and the line of a shot, mod 180. */
function lineAngleDeg(pathDir: Vec, zc: ZoneContext): number {
  const aim = norm(sub(zc.pocket.target, zc.ball));
  const a = angleBetween(pathDir, aim);
  return (Math.min(a, Math.PI - a) * 180) / Math.PI;
}

/** Per-pocket zone target for one solver layer: shared by every node. */
interface ZoneTarget {
  pocket: Pocket;
  zc: ZoneContext;
  /**
   * Window bar (see zone.ts): a landing must be near the best ANY pocket
   * offers, not just this pocket's own best — the closest (easiest) pocket
   * sets the quality bar, so a zone via a worse pocket only counts where it
   * is nearly as good. Search-side twin of the rendering's second-choice rule.
   */
  bar: number;
  /** Bar relative to this pocket's own peak only — the lenient fallback. */
  ownBar: number;
}

function zoneTargets(nextBall: Ball, laterBalls: Ball[], skill: SkillProfile): ZoneTarget[] {
  const zoneObstacles = laterBalls.map((b) => b.pos);
  const found: { pocket: Pocket; zc: ZoneContext; peak: number }[] = [];
  let bestPeak = 0;
  for (const pocket of POCKETS) {
    const zc = zoneContext(nextBall.pos, pocket, zoneObstacles);
    if (!zc.ballPathClear) continue;
    const peak = zonePeak(zc, skill);
    if (peak <= 0) continue;
    bestPeak = Math.max(bestPeak, peak);
    found.push({ pocket, zc, peak });
  }
  return found.map(({ pocket, zc, peak }) => ({
    pocket,
    zc,
    bar: Math.max(ZONE_FLOOR, ZONE_RELATIVE * bestPeak),
    ownBar: Math.max(ZONE_FLOOR, ZONE_RELATIVE * peak),
  }));
}

function routeCandidates(
  node: Node,
  nextBall: Ball,
  laterBalls: Ball[],
  targets: ZoneTarget[],
  skill: SkillProfile,
  lenient: boolean,
): RouteCandidate[] {
  const g = node.pending.g;
  const routeObstacles = [nextBall.pos, ...laterBalls.map((b) => b.pos)];
  const out: RouteCandidate[] = [];

  for (const t of targets) {
    const { pocket, zc } = t;
    const bar = lenient ? t.ownBar : t.bar;
    // Stop shot: only available when the current shot is near straight.
    if (g.cut < (9 * Math.PI) / 180) {
      const landing = g.ghost;
      const v = zoneValue(landing, zc, skill);
      if (v >= bar) {
        out.push({
          node, zc, nextPocket: pocket,
          type: 'stop', dir: stopDir(g), travel: 0.5, rails: 0,
          landing, zoneLen: null, entryDeg: null,
          proxy: node.score * v * skill.typeReliability.stop,
        });
      }
    }

    for (const type of ['follow', 'stun', 'lowTouch', 'draw'] as ShotType[]) {
      const dir = departureDir(g, type);
      if (!dir) continue;
      const minTravel = minCueTravel(g, type);
      const samples = samplePath(g.ghost, dir, routeObstacles, zc, skill);
      const intervals = findIntervals(samples, bar);
      for (const iv of intervals) {
        const ivLen = iv.s1 - iv.s0;
        const rawTargets =
          ivLen < 6 ? [iv.peakS] : [iv.s0 + ivLen * 0.4, iv.s0 + ivLen * 0.65];
        // The cue ball cannot travel less than pocket pace leaves it with.
        const targets = rawTargets
          .map((s) => Math.max(s, minTravel))
          .filter((s) => s <= iv.s1);
        for (const sTarget of targets) {
          const rails = railsAtDistance(samples, sTarget);
          const tr = tracePath(g.ghost, dir, sTarget, routeObstacles, 4);
          if (tr.outcome !== 'ok') continue;
          const v = valueNear(samples, sTarget);
          const sigS = distanceSigma(type, sTarget, rails, skill, g.dCueGhost);
          const stayFactor = Math.min(1, ivLen / (3 * sigS));
          out.push({
            node, zc, nextPocket: pocket,
            type, dir, travel: sTarget, rails,
            landing: tr.end,
            zoneLen: ivLen,
            entryDeg: lineAngleDeg(iv.entryDir, zc),
            proxy:
              node.score * v * stayFactor * routeReliability(type, g.dCueGhost, skill),
          });
        }
      }
    }
  }
  return out;
}

function expandNodes(
  nodes: Node[],
  nextBall: Ball,
  laterBalls: Ball[],
  skill: SkillProfile,
): Node[] {
  const targets = zoneTargets(nextBall, laterBalls, skill);
  // Strict pass first: every pocket held to the best pocket's bar. Only when
  // nothing clears it (the good pocket is unreachable from every node) do the
  // per-pocket fallback bars get a turn, so the layout still solves.
  for (const lenient of [false, true]) {
    const children = expandPass(nodes, nextBall, laterBalls, targets, skill, lenient);
    if (children.length > 0 || lenient) return children;
  }
  return [];
}

function expandPass(
  nodes: Node[],
  nextBall: Ball,
  laterBalls: Ball[],
  targets: ZoneTarget[],
  skill: SkillProfile,
  lenient: boolean,
): Node[] {
  const candidates: RouteCandidate[] = [];
  for (const node of nodes) {
    candidates.push(
      ...routeCandidates(node, nextBall, laterBalls, targets, skill, lenient),
    );
  }
  candidates.sort((a, b) => b.proxy - a.proxy);

  const children: Node[] = [];
  const routeObstacles = [nextBall.pos, ...laterBalls.map((b) => b.pos)];
  for (const c of candidates.slice(0, EVAL_CAP)) {
    // P(reach the zone) compounds the landing spread with the execution
    // reliability of the cue-ball action itself (draw is the toughest).
    const e =
      expectedNextPot(
        c.node.pending.g.ghost, c.dir, c.travel, c.type, c.rails,
        routeObstacles, c.zc, skill, c.node.pending.g.dCueGhost,
      ) * routeReliability(c.type, c.node.pending.g.dCueGhost, skill);
    if (e <= 0.01) continue;
    const gNext = shotGeometry(c.landing, nextBall.pos, c.nextPocket);
    if (!gNext) continue;
    const potNext = zoneValue(c.landing, c.zc, skill);
    if (potNext <= 0) continue;
    const intendedPath = tracePath(
      c.node.pending.g.ghost, c.dir, c.travel, routeObstacles, 4,
    );
    const risk = pocketRisk(intendedPath.points);
    const p = c.node.pending;
    const shot: PlannedShot = {
      ball: p.ball,
      pocket: p.pocket,
      cuePos: p.cuePos,
      ghost: p.g.ghost,
      cutDeg: (p.g.cut * 180) / Math.PI,
      potProb: p.potProb,
      type: c.type,
      path: intendedPath.points,
      landing: c.landing,
      rails: c.rails,
      travel: c.travel,
      eNext: e,
      zoneLen: c.zoneLen,
      entryDeg: c.entryDeg,
      explanation: '',
    };
    children.push({
      score: c.node.score * e * risk,
      sortKey:
        c.node.sortKey * e * risk * complexityDiscount(c.type, c.rails, c.travel),
      done: [...c.node.done, shot],
      pending: {
        ball: nextBall,
        pocket: c.nextPocket,
        cuePos: c.landing,
        g: gNext,
        potProb: potNext,
      },
    });
  }
  children.sort((a, b) => b.sortKey - a.sortKey);
  return children.slice(0, BEAM);
}

function initialNodes(layout: Layout, skill: SkillProfile): Node[] {
  const first = layout.balls[0];
  const others = layout.balls.slice(1).map((b) => b.pos);
  const nodes: Node[] = [];
  const angles = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
  const dists = [10, 16, 24, 34];

  for (const pocket of POCKETS) {
    const zc = zoneContext(first.pos, pocket, others);
    if (!zc.ballPathClear) continue;
    const aim = norm(sub(pocket.target, first.pos));
    const aimBack = scale(aim, -1);
    const ghost = add(first.pos, scale(aimBack, 2 * 1.125));
    const pocketNodes: Node[] = [];
    for (const aDeg of angles) {
      for (const d of dists) {
        const c = add(ghost, scale(rotate(aimBack, (aDeg * Math.PI) / 180), d));
        const v = zoneValue(c, zc, skill);
        if (v < 0.35) continue;
        const g = shotGeometry(c, first.pos, pocket);
        if (!g) continue;
        pocketNodes.push({
          score: v,
          sortKey: v,
          done: [],
          pending: { ball: first, pocket, cuePos: c, g, potProb: v },
        });
      }
    }
    pocketNodes.sort((a, b) => b.score - a.score);
    nodes.push(...pocketNodes.slice(0, 12));
  }
  return nodes;
}

/**
 * Remeasure zoneLen/entryDeg for the explanations against the zone the user
 * actually SEES (which carries onward control), not the pot-only zone the
 * route search ran on — otherwise the text can call a tight window wide.
 */
function remeasureZones(shots: PlannedShot[], skill: SkillProfile): void {
  for (let i = 0; i < shots.length - 1; i++) {
    const shot = shots[i];
    const next = shots[i + 1];
    if (!shot.path || shot.zoneLen === null) continue;
    const later = shots.slice(i + 2).map((s) => s.ball.pos);
    const after = shots[i + 2] ?? null;
    const afterObstacles = shots.slice(i + 3).map((s) => s.ball.pos);
    const nextZones = after
      ? POCKETS.map((p) => zoneContext(after.ball.pos, p, afterObstacles)).filter(
          (z) => z.ballPathClear,
        )
      : [];
    const zc = zoneContext(next.ball.pos, next.pocket, later, nextZones);
    const bar = zoneBar(zc, skill);
    // Walk the intended path; keep the in-window run the cue ball ends in.
    let run = 0;
    let runEntryDir: Vec | null = null;
    let inside = false;
    for (let j = 0; j + 1 < shot.path.length; j++) {
      const a = shot.path[j];
      const b = shot.path[j + 1];
      const segLen = dist(a, b);
      if (segLen < 1e-9) continue;
      const d = norm(sub(b, a));
      for (let t = 0; t <= segLen; t += WALK_STEP) {
        if (zoneValue(add(a, scale(d, t)), zc, skill) >= bar) {
          if (!inside) {
            run = 0;
            runEntryDir = d;
            inside = true;
          }
          run += WALK_STEP;
        } else {
          inside = false;
        }
      }
    }
    if (inside && runEntryDir) {
      shot.zoneLen = run;
      shot.entryDeg = lineAngleDeg(runEntryDir, zc);
    }
  }
}

function finalize(node: Node, skill: SkillProfile): Pattern {
  const p = node.pending;
  const last: PlannedShot = {
    ball: p.ball,
    pocket: p.pocket,
    cuePos: p.cuePos,
    ghost: p.g.ghost,
    cutDeg: (p.g.cut * 180) / Math.PI,
    potProb: p.potProb,
    type: null,
    path: null,
    landing: null,
    rails: 0,
    travel: 0,
    eNext: null,
    zoneLen: null,
    entryDeg: null,
    explanation: '',
  };
  const shots = [...node.done, last];
  remeasureZones(shots, skill);
  for (let i = 0; i < shots.length; i++) {
    shots[i].explanation = explainShot(shots[i], shots[i + 1] ?? null, i === 0, skill);
  }
  return { shots, score: node.score };
}

const pct = (v: number) => `${Math.min(99, Math.round(v * 100))}%`;

function typePhrase(type: ShotType): string {
  switch (type) {
    case 'stop': return 'Stop shot';
    case 'follow': return 'A natural rolling follow';
    case 'stun': return 'A stun off the tangent line';
    case 'lowTouch': return 'A touch of low (slight draw)';
    case 'draw': return 'A draw';
  }
}

function railsPhrase(rails: number): string {
  if (rails === 0) return '';
  if (rails === 1) return ' off one rail';
  return ` off ${rails === 2 ? 'two' : 'three'} rails`;
}

function entryPhrase(entryDeg: number | null, margin: number): string {
  if (entryDeg === null) return '';
  if (entryDeg <= 35) return ' — coming into the line of the shot';
  if (margin >= 4) return ' — a wide window, the angle of entry hardly matters';
  if (entryDeg <= 60) return ' — entering the zone at an angle';
  return ' — crossing the line, small margin but the best available';
}

function explainShot(
  shot: PlannedShot,
  next: PlannedShot | null,
  first: boolean,
  skill: SkillProfile,
): string {
  const intro = first
    ? `Ball in hand: place the cue ball for a ${Math.round(shot.cutDeg)}° cut on the ${shot.ball.num}, into the ${shot.pocket.label}.`
    : `${shot.ball.num} ball into the ${shot.pocket.label} (${Math.round(shot.cutDeg)}° cut).`;
  if (!shot.type || !next) {
    return `${intro} Pot ${pct(shot.potProb)} — finish the rack.`;
  }
  let route: string;
  if (shot.type === 'stop') {
    route = `Stop shot — the cue ball stays put for the ${next.ball.num}.`;
  } else {
    let zone = '';
    if (shot.zoneLen !== null) {
      const margin =
        shot.zoneLen /
        distanceSigma(shot.type, shot.travel, shot.rails, skill, dist(shot.cuePos, shot.ghost));
      const size =
        shot.zoneLen > 40
          ? `a wide-open zone (${Math.round(shot.zoneLen)}″ of the path lies inside it`
          : `the zone (${Math.round(shot.zoneLen)}″ of the path lies inside it`;
      zone = ` — ${size}${entryPhrase(shot.entryDeg, margin)})`;
    }
    route = `${typePhrase(shot.type)}${railsPhrase(shot.rails)} sends the cue ball into position for the ${next.ball.num}${zone}.`;
  }
  return `${intro} ${route} Pot ${pct(shot.potProb)}, position ${pct(shot.eNext ?? 0)}.`;
}

export function solve(layout: Layout, skill: SkillProfile): Pattern | null {
  let nodes = initialNodes(layout, skill);
  if (nodes.length === 0) return null;
  for (let k = 1; k < layout.balls.length; k++) {
    nodes = expandNodes(nodes, layout.balls[k], layout.balls.slice(k + 1), skill);
    if (nodes.length === 0) return null;
  }
  return finalize(nodes[0], skill);
}
