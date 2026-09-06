// Pattern solver: beam search over Patterns (see CONTEXT.md). The forward
// search starts from ball-in-hand seeds (seed.ts), expands one ball at a time
// using route exploration (route.ts), and annotates the winning pattern with
// human-readable explanations (explain.ts).

import {
  Vec,
  add,
  scale,
  norm,
  sub,
  dist,
} from './geometry';
import { Ball, Layout, Pocket, POCKETS } from './table';
import {
  ShotGeometry,
  ShotType,
  Sidespin,
  shotGeometry,
  traceShot,
} from './shots';
import { SkillProfile, perturbSamples, potPaceFactor } from './skill';
import {
  ZoneContext,
  zoneBar,
  zoneContext,
  zoneValue,
} from './zone';
import { ValueSurface, buildSurfaces, surfacesForLayout, zoneInputsForBall } from './value';
import type { RouteLanding, SearchMode, ZoneTarget } from './route';
import {
  clearanceRisk,
  expectedNextPot,
  finalSafetyRoute,
  lineAngleDeg,
  pocketRisk,
  routeCandidates,
  zoneTargets,
  WALK_STEP,
} from './route';
import { initialNodes } from './seed';
import { explainShot } from './explain';

export { expectedNextPot, zoneTargets } from './route';
export type { ZoneTarget } from './route';
export { initialNodes } from './seed';

export interface PlannedShot {
  ball: Ball;
  pocket: Pocket;
  cuePos: Vec;
  ghost: Vec;
  cutDeg: number;
  potProb: number;
  /** Cue-ball action, if a route is available. */
  type: ShotType | null;
  sidespin: Sidespin;
  path: Vec[] | null;
  landing: Vec | null;
  rails: number;
  travel: number;
  /** Expected pot probability of the NEXT shot over the landing spread. */
  eNext: number | null;
  /**
   * What the chosen route can reach in the next zone (the best zone value
   * along its landing stretch): caps the drawn window's quality bar so the
   * window shows the stretch this route is actually playing for, and the
   * planned landing always sits inside it.
   */
  windowRef: number | null;
  /** Length of the intended path that lies inside the next zone, inches. */
  zoneLen: number | null;
  /** Angle between path at zone entry and the line of the next shot, deg. */
  entryDeg: number | null;
  /**
   * The Position Zone this shot is playing for: the chosen-pocket zone of the
   * following ball, gated for the rest of the rack. Resolved once in finalize
   * and read by the renderer and the explanation, so the drawn window is
   * exactly the one the route was scored against. null for the final ball.
   */
  zone: ZoneContext | null;
  explanation: string;
}

export interface Pattern {
  shots: PlannedShot[];
  score: number;
}

const BEAM = 40;
const EVAL_CAP = 130;
const SCREEN_BEAM = 8;
const SCREEN_EVAL_CAP = 32;
const SCREEN_GRID_STEP = 3;
// Rounded quadrature weights sum to slightly more than one.
const POSITION_WEIGHT_SUM = perturbSamples(0, 0).reduce((sum, sample) => sum + sample.weight, 0);

interface PendingShot {
  ball: Ball;
  pocket: Pocket;
  cuePos: Vec;
  g: ShotGeometry;
  potProb: number;
  /** The shot from this cue was placed exactly by hand/drag, not arrived at. */
  fromHand: boolean;
}

/** Exported (with initialNodes/expandNodes) for the beam-step diagnostics. */
export interface Node {
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
  // Travel only breaks TRUE ties: going longer on a natural angle for a
  // bigger window (or to come in along the line) is often the easier play,
  // and the score's window math decides that — this must not override it.
  return 1 - (TYPE_RANK[type] * 0.01 + rails * 0.004 + travel * 0.0002);
}

/**
 * The along-the-line counterpart of complexityDiscount, same sortKey-only
 * contract: on a near-tie prefer the route that ENTERS the window along the
 * next shot's line (the pattern-play ideal the user keeps picking — wherever
 * the cue ball stops on that line, there is a shot) over one that cuts
 * across it. Small enough that the score's window math still decides any
 * real difference; never reported to the user.
 */
function alignBoost(entryDeg: number | null): number {
  if (entryDeg === null) return 1;
  return 1 + 0.04 * Math.max(0, 1 - entryDeg / 35);
}

/**
 * Order beam children: real probability wins, but when two are within 2% of
 * each other the keep-it-simple/along-the-line tie-break (sortKey) decides.
 * This 2% indifference band is a deliberate near-tie zone — it is not a strict
 * weak ordering (three children can chain a~b~c with a and c outside the
 * band), so the resulting order is approximate at band edges. That is fine
 * here: the band only ever swaps near-equal patterns, and V8's sort is
 * deterministic, so the winner stays stable across runs. Bucketing against a
 * single reference would be transitive but shifts calibrated goldens, so the
 * pairwise band stays.
 */
function sortChildren(children: Node[]): void {
  children.sort((a, b) => {
    const scale = Math.max(a.score, b.score, 1e-9);
    if (Math.abs(a.score - b.score) > 0.02 * scale) return b.score - a.score;
    return b.sortKey - a.sortKey;
  });
}

interface RouteCandidate extends RouteLanding {
  node: Node;
  proxy: number;
}

export function expandNodes(
  nodes: Node[],
  balls: Ball[],
  m: number,
  surfaces: (ValueSurface | null)[],
  skill: SkillProfile,
  mode: SearchMode = 'full',
): Node[] {
  const targets = zoneTargets(balls, m, surfaces, skill, mode);
  const { obstacles: laterPos } = zoneInputsForBall(balls, m, surfaces);
  return expandToTargets(nodes, balls[m], laterPos, targets, skill, mode);
}

function expandPass(
  nodes: Node[],
  nextBall: Ball,
  laterPos: Vec[],
  targets: ZoneTarget[],
  skill: SkillProfile,
  lenient: boolean,
  mode: SearchMode,
): Node[] {
  const obstacles = [nextBall.pos, ...laterPos];
  const candidates: RouteCandidate[] = [];
  for (const node of nodes) {
    for (const l of routeCandidates(node.pending.g, obstacles, targets, skill, lenient, mode)) {
      candidates.push({ ...l, node, proxy: node.score * l.merit });
    }
  }
  candidates.sort((a, b) => b.proxy - a.proxy);

  const children: Node[] = [];
  for (const c of candidates.slice(0, mode === 'screen' ? SCREEN_EVAL_CAP : EVAL_CAP)) {
    // P(reach the zone) compounds the landing spread (carom-direction
    // sensitivity included: a natural-angle follow's carom is easy to
    // direct, a long stun's or draw's is not) with the route's ease — type
    // reliability, hit power at this cut, draw rail-room.
    const intendedPath = traceShot(c.node.pending.g, c.type, c.travel, obstacles, {
      maxRails: 4, sidespin: c.sidespin,
    });
    if (intendedPath.outcome !== 'ok') continue;
    const curve = intendedPath.curve;
    const e =
      expectedNextPot(
        c.node.pending.g.ghost, c.dir, c.travel, c.type, c.rails,
        obstacles, c.zc, skill, c.node.pending.g.dCueGhost,
        { g: c.node.pending.g, pocket: c.node.pending.pocket },
        curve,
        c.node.pending.fromHand,
        c.sidespin,
      ) * c.ease * c.windowFactor;
    if (e <= 0.01) continue;
    const gNext = shotGeometry(c.landing, nextBall.pos, c.nextPocket);
    if (!gNext) continue;
    // Pot-only: the next shot's reported pot % must not carry the onward gate.
    const potNext = zoneValue(c.landing, c.zcPot, skill);
    if (potNext <= 0) continue;

    const risk =
      pocketRisk(intendedPath.points) * clearanceRisk(intendedPath.points, laterPos);
    const p = c.node.pending;
    const shot: PlannedShot = {
      ball: p.ball,
      pocket: p.pocket,
      cuePos: p.cuePos,
      ghost: p.g.ghost,
      cutDeg: (p.g.cut * 180) / Math.PI,
      potProb: p.potProb * potPaceFactor(p.g, c.type, intendedPath.powerTravel, skill),
      type: c.type,
      sidespin: c.sidespin,
      path: intendedPath.points,
      landing: c.landing,
      rails: c.rails,
      travel: c.travel,
      eNext: e,
      windowRef: c.windowRef,
      zoneLen: c.zoneLen,
      entryDeg: c.entryDeg,
      zone: null,
      explanation: '',
    };
    children.push({
      score: c.node.score * e * risk,
      sortKey:
        c.node.sortKey * e * risk *
        complexityDiscount(c.type, c.rails, c.travel) * alignBoost(c.entryDeg),
      done: [...c.node.done, shot],
      pending: {
        ball: nextBall,
        pocket: c.nextPocket,
        cuePos: c.landing,
        g: gNext,
        potProb: potNext,
        fromHand: false,
      },
    });
  }
  sortChildren(children);
  return children.slice(0, mode === 'screen' ? SCREEN_BEAM : BEAM);
}


/**
 * Resolve the Position Zone each non-final shot is playing for and stamp it on
 * the shot, so the renderer (scene.ts) and the explanation read the SAME zone
 * the route was scored against instead of rebuilding it. zoneLen/entryDeg are
 * then remeasured against that zone — with the pocket actually chosen (the
 * search bar may have been the cross-pocket one) and a finer walk along the
 * final path — the same remeasure this pass did before it also owned stamping.
 */
function resolveShotZones(
  shots: PlannedShot[],
  balls: Ball[],
  firstBallIndex: number,
  skill: SkillProfile,
  surfaces: (ValueSurface | null)[],
): void {
  for (let i = 0; i + 1 < shots.length; i++) {
    const shot = shots[i];
    const next = shots[i + 1];
    const { obstacles, gate } = zoneInputsForBall(balls, firstBallIndex + i + 1, surfaces);
    const zc = zoneContext(next.ball.pos, next.pocket, obstacles, [], gate);
    shot.zone = zc;
    if (!shot.path || shot.zoneLen === null) continue;
    const bar = zoneBar(zc, skill, 0, shot.windowRef ?? Infinity);
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

function finalize(
  nodes: Node[],
  balls: Ball[],
  firstBallIndex: number,
  skill: SkillProfile,
  surfaces: (ValueSurface | null)[],
  explainFirstAsHand = true,
  mode: SearchMode = 'full',
): Pattern | null {
  for (const node of nodes) {
    const p = node.pending;
    // The final ball has no next Position Window, so it gets a SAFETY Route: the
    // pocket x shot type maximizing P(pot) x P(no scratch) at minimal natural
    // travel (route.ts). Its scratch risk — an automatic loss, unaccounted for
    // while the 9 was a null pot-only shot — folds into the reported run-out
    // probability here, the same pocketRisk pricing every mid-rack route carries.
    const safe = finalSafetyRoute(p.cuePos, p.ball.pos, skill);
    if (!safe) continue;
    const last: PlannedShot = {
      ball: p.ball,
      cuePos: p.cuePos,
      eNext: null,
      windowRef: null,
      zoneLen: null,
      entryDeg: null,
      zone: null,
      explanation: '',
      pocket: safe.pocket,
      ghost: safe.g.ghost,
      cutDeg: (safe.g.cut * 180) / Math.PI,
      potProb: safe.potProb,
      type: safe.type,
      sidespin: safe.sidespin,
      path: safe.path,
      landing: safe.landing,
      rails: safe.rails,
      travel: safe.travel,
    };
    const score = node.score * safe.noScratch *
      potPaceFactor(safe.g, safe.type, safe.powerTravel, skill);
    const shots = [...node.done, last];
    if (mode === 'screen') return { shots, score };
    resolveShotZones(shots, balls, firstBallIndex, skill, surfaces);
    for (let i = 0; i < shots.length; i++) {
      shots[i].explanation = explainShot(
        shots[i],
        shots[i + 1] ?? null,
        i === 0 && explainFirstAsHand,
        skill,
      );
    }
    return { shots, score };
  }
  return null;
}

function fixedCueNodes(
  layout: Layout,
  startIndex: number,
  cuePos: Vec,
  surfaces: (ValueSurface | null)[],
  skill: SkillProfile,
  fromHand: boolean,
): Node[] {
  const ball = layout.balls[startIndex];
  const { obstacles } = zoneInputsForBall(layout.balls, startIndex, surfaces);
  const nodes: Node[] = [];
  for (const pocket of POCKETS) {
    const zc = zoneContext(ball.pos, pocket, obstacles);
    if (!zc.ballPathClear) continue;
    const potProb = zoneValue(cuePos, zc, skill);
    if (potProb <= 0) continue;
    const g = shotGeometry(cuePos, ball.pos, pocket);
    if (!g) continue;
    nodes.push({
      score: potProb,
      sortKey: potProb,
      done: [],
      pending: { ball, pocket, cuePos, g, potProb, fromHand },
    });
  }
  sortChildren(nodes);
  return nodes;
}

function expandToTargets(
  nodes: Node[],
  nextBall: Ball,
  laterPos: Vec[],
  targets: ZoneTarget[],
  skill: SkillProfile,
  mode: SearchMode = 'full',
): Node[] {
  for (const lenient of [false, true]) {
    const children = expandPass(nodes, nextBall, laterPos, targets, skill, lenient, mode);
    if (children.length > 0 || lenient) return children;
  }
  return [];
}

export function solveFromCue(
  layout: Layout,
  skill: SkillProfile,
  startIndex: number,
  cuePos: Vec,
  surfaces: (ValueSurface | null)[] = surfacesForLayout(layout, skill),
): Pattern | null {
  if (startIndex < 0 || startIndex >= layout.balls.length) return null;
  let nodes = fixedCueNodes(layout, startIndex, cuePos, surfaces, skill, true);
  if (nodes.length === 0) return null;
  for (let k = startIndex + 1; k < layout.balls.length; k++) {
    nodes = expandNodes(nodes, layout.balls, k, surfaces, skill);
    if (nodes.length === 0) return null;
  }
  return finalize(nodes, layout.balls, startIndex, skill, surfaces, startIndex === 0);
}

export function previewLegFromCue(
  layout: Layout,
  skill: SkillProfile,
  startIndex: number,
  cuePos: Vec,
  targetZone: ZoneContext,
): PlannedShot | null {
  if (startIndex < 0 || startIndex + 1 >= layout.balls.length) return null;
  const surfaces = surfacesForLayout(layout, skill);
  const nodes = fixedCueNodes(layout, startIndex, cuePos, surfaces, skill, true);
  if (nodes.length === 0) return null;
  const nextBall = layout.balls[startIndex + 1];
  const target: ZoneTarget = {
    pocket: targetZone.pocket,
    zc: targetZone,
    zcPot: zoneContext(targetZone.ball, targetZone.pocket, targetZone.obstacles),
  };
  const children = expandToTargets(nodes, nextBall, targetZone.obstacles, [target], skill);
  const best = children[0]?.done[0] ?? null;
  if (!best) return null;
  best.zone = targetZone;
  return best;
}

/** Full search, with an optional score floor for generation's best-so-far cutoff. */
export function solve(layout: Layout, skill: SkillProfile, minimumScore = 0): Pattern | null {
  // Backward pass first (value.ts): V_k surfaces from the 9 down, so every
  // zone the forward beam search measures against already carries the chain
  // of requirements of the balls after it.
  const surfaces = surfacesForLayout(layout, skill);
  return searchLayout(layout, skill, surfaces, 'full', minimumScore);
}

/** Cheap ordering hint. Coarse grids stay outside the full-solve surface cache. */
export function screenLayout(layout: Layout, skill: SkillProfile): number {
  const surfaces = buildSurfaces(layout.balls, skill, SCREEN_GRID_STEP);
  return searchLayout(layout, skill, surfaces, 'screen', 0)?.score ?? 0;
}

function searchLayout(
  layout: Layout,
  skill: SkillProfile,
  surfaces: (ValueSurface | null)[],
  mode: SearchMode,
  minimumScore: number,
): Pattern | null {
  // Ball-in-hand placement may be engineered against the SECOND ball's shot
  // lines (shotline-aligned seeds): hand the next zone targets to the seeder.
  const nextTargets =
    layout.balls.length > 1 ? zoneTargets(layout.balls, 1, surfaces, skill, mode) : [];
  let nodes = initialNodes(layout, skill, surfaces, nextTargets);
  if (nodes.length === 0) return null;
  for (let k = 1; k < layout.balls.length; k++) {
    nodes = expandNodes(nodes, layout.balls, k, surfaces, skill, mode);
    const remainingFactor = POSITION_WEIGHT_SUM ** (layout.balls.length - 1 - k);
    if (nodes.length === 0 || nodes.every(node => node.score * remainingFactor < minimumScore)) return null;
  }
  const pattern = finalize(nodes, layout.balls, 0, skill, surfaces, true, mode);
  return pattern && pattern.score >= minimumScore ? pattern : null;
}
