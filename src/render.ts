// Pure SVG renderer: top-down table diagram in the style of the knowledgebase
// articles — green felt, tan rails, shaded position-zone windows, arrowed
// cue-ball paths, dashed ghost balls.

import { Vec } from './geometry';
import { TABLE_W, TABLE_H, BALL_R, POCKETS, Ball } from './table';

export const SVG_SCALE = 9; // px per inch
export const RAIL_INCHES = 5; // rail width, inches
export const VIEW_W = (TABLE_W + 2 * RAIL_INCHES) * SVG_SCALE;
export const VIEW_H = (TABLE_H + 2 * RAIL_INCHES) * SVG_SCALE;

const S = SVG_SCALE;
const RAIL = RAIL_INCHES;

export interface SceneShot {
  cuePos: Vec;
  ghost: Vec;
  ballPos: Vec;
  pocketTarget: Vec;
  path: Vec[] | null;
  landing: Vec | null;
}

export interface Scene {
  balls: Ball[];
  /** The previous shot's destination window; first shot uses the whole table. */
  originZone: Vec[][];
  originZoneHighlighted?: boolean;
  /** Position window polygons (a ball cutting clean across can split one). */
  zone: Vec[][];
  /** Zones via other open pockets: a fainter, second-choice expansion. */
  altZones: Vec[][];
  shot: SceneShot | null;
  /** Faint preview paths (overview step). */
  ghostPaths: Vec[][];
  cue: Vec | null;
  cueDraggable?: boolean;
}

const px = (v: number) => (v * S).toFixed(1);
const X = (v: number) => px(v + RAIL);
const Y = (v: number) => px(TABLE_H - v + RAIL); // flip y so +y is up

export function tableToSvgPoint(p: Vec): Vec {
  return {
    x: (p.x + RAIL_INCHES) * SVG_SCALE,
    y: (TABLE_H - p.y + RAIL_INCHES) * SVG_SCALE,
  };
}

export function svgToTablePoint(p: Vec): Vec {
  return {
    x: p.x / SVG_SCALE - RAIL_INCHES,
    y: TABLE_H + RAIL_INCHES - p.y / SVG_SCALE,
  };
}

function pt(p: Vec): string {
  return `${X(p.x)},${Y(p.y)}`;
}

function polyline(points: Vec[], attrs: string): string {
  return `<polyline points="${points.map(pt).join(' ')}" fill="none" ${attrs}/>`;
}

function line(a: Vec, b: Vec, attrs: string): string {
  return `<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" ${attrs}/>`;
}

function ballColor(num: number): { fill: string; stripe: boolean } {
  const colors: Record<number, string> = {
    1: '#f2b705', 2: '#1e58c8', 3: '#d23b32', 4: '#5c2d83',
    5: '#e6731f', 6: '#1d7a4d', 7: '#8a2c35', 8: '#191919',
    9: '#f2b705',
  };
  return { fill: colors[num] ?? '#888', stripe: num === 9 };
}

function drawBall(b: Ball, faded = false): string {
  const { fill, stripe } = ballColor(b.num);
  const r = BALL_R * S;
  const cx = X(b.pos.x);
  const cy = Y(b.pos.y);
  const op = faded ? 0.25 : 1;
  let body: string;
  if (stripe) {
    const id = `clip${b.num}-${cx}-${cy}`;
    body =
      `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fdfdf6"/>` +
      `<rect x="${Number(cx) - r}" y="${Number(cy) - r * 0.62}" width="${2 * r}" height="${r * 1.24}" fill="${fill}" clip-path="url(#${id})"/>`;
  } else {
    body = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
  }
  return (
    `<g opacity="${op}">` +
    body +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="0.8"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.52}" fill="#fdfdf6"/>` +
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${r * 0.78}" font-family="Arial, sans-serif" font-weight="bold" fill="#222">${b.num}</text>` +
    `</g>`
  );
}

function drawCueBall(p: Vec, dashed = false, draggable = false): string {
  const r = BALL_R * S;
  const stroke = dashed
    ? `stroke="#fdfdf6" stroke-width="1.4" stroke-dasharray="3 3" fill="rgba(253,253,246,0.25)"`
    : `stroke="#9a9a8e" stroke-width="0.9" fill="#fdfdf6"`;
  const dragAttrs = draggable ? ` class="cue-ball-draggable" data-role="cue-ball"` : '';
  return `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${r}"${dragAttrs} ${stroke}/>`;
}

function tableBase(): string {
  const w = (TABLE_W + 2 * RAIL) * S;
  const h = (TABLE_H + 2 * RAIL) * S;
  let s = `<rect x="0" y="0" width="${w}" height="${h}" rx="${1.8 * S}" fill="#8b5a33"/>`;
  s += `<rect x="${px(RAIL * 0.55)}" y="${px(RAIL * 0.55)}" width="${(TABLE_W + 0.9 * RAIL) * S}" height="${(TABLE_H + 0.9 * RAIL) * S}" fill="#2e7a44"/>`;
  s += `<rect x="${px(RAIL)}" y="${px(RAIL)}" width="${TABLE_W * S}" height="${TABLE_H * S}" fill="#3c9158"/>`;
  for (const p of POCKETS) {
    const isCorner = p.id.length === 2 && p.id !== 'BS' && p.id !== 'TS';
    const off = isCorner ? 1.4 : 1.6;
    const cx = p.target.x + p.facing.x * off;
    const cy = p.target.y + p.facing.y * off;
    s += `<circle cx="${X(cx)}" cy="${Y(cy)}" r="${3.1 * S}" fill="#14100c"/>`;
  }
  // sights (diamonds)
  const diamond = (x: number, y: number) =>
    `<circle cx="${X(x)}" cy="${Y(y)}" r="${0.45 * S}" fill="#e8dcc0"/>`;
  for (let i = 1; i < 8; i++) {
    if (i === 4) continue;
    s += diamond((TABLE_W * i) / 8, -RAIL / 2);
    s += diamond((TABLE_W * i) / 8, TABLE_H + RAIL / 2);
  }
  for (let i = 1; i < 4; i++) {
    s += diamond(-RAIL / 2, (TABLE_H * i) / 4);
    s += diamond(TABLE_W + RAIL / 2, (TABLE_H * i) / 4);
  }
  return s;
}

export function renderScene(scene: Scene): string {
  const w = VIEW_W;
  const h = VIEW_H;
  const defs =
    `<marker id="arrowRed" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#d63a3a"/></marker>` +
    `<marker id="arrowDark" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#222"/></marker>`;
  let body = tableBase();

  if (scene.originZoneHighlighted) {
    const originAttrs =
      `fill="rgba(253,253,246,0.22)" stroke="rgba(253,253,246,0.85)" stroke-width="2.4" stroke-dasharray="6 4"`;
    for (const oz of scene.originZone) {
      if (oz.length >= 3) {
        body += `<polygon points="${oz.map(pt).join(' ')}" ${originAttrs}/>`;
      }
    }
  }

  for (const az of scene.altZones) {
    if (az.length >= 3) {
      body += `<polygon points="${az.map(pt).join(' ')}" fill="rgba(190,190,178,0.22)" stroke="#9a9a8e" stroke-width="1.2" stroke-dasharray="4 4"/>`;
    }
  }
  for (const z of scene.zone) {
    if (z.length >= 3) {
      body += `<polygon points="${z.map(pt).join(' ')}" fill="rgba(255,216,77,0.35)" stroke="#caa419" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    }
  }

  for (const gp of scene.ghostPaths) {
    if (gp.length >= 2) body += polyline(gp, `stroke="rgba(253,253,246,0.6)" stroke-width="2.2" stroke-dasharray="7 5"`);
  }

  const shot = scene.shot;
  if (shot) {
    // object ball -> pocket
    body += line(shot.ballPos, shot.pocketTarget, `stroke="#222" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#arrowDark)"`);
    // cue -> ghost
    body += line(shot.cuePos, shot.ghost, `stroke="rgba(253,253,246,0.85)" stroke-width="2"`);
    if (shot.path && shot.path.length >= 2) {
      body += polyline(shot.path, `stroke="#d63a3a" stroke-width="2.6" marker-end="url(#arrowRed)"`);
    }
    if (shot.landing) body += drawCueBall(shot.landing, true);
  }

  for (const b of scene.balls) body += drawBall(b);
  if (scene.cue) body += drawCueBall(scene.cue, false, scene.cueDraggable ?? false);

  return (
    `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">` +
    `<defs>` +
    defs +
    `</defs>` +
    body +
    `</svg>`
  );
}
