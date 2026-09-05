// Pure SVG renderer: a Diamond Pro-Am style table with training overlays.
// Corner mouth width is shared with the solver's aiming targets.

import { Vec } from './geometry';
import { TABLE_W, TABLE_H, BALL_R, CORNER_MOUTH, Ball } from './table';

const S = 9; // px per inch
const RAIL = 7; // rail width, inches

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
    x: (p.x + RAIL) * S,
    y: (TABLE_H - p.y + RAIL) * S,
  };
}

export function svgToTablePoint(p: Vec): Vec {
  return {
    x: p.x / S - RAIL,
    y: TABLE_H + RAIL - p.y / S,
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
    `<ellipse cx="${cx}" cy="${Number(cy) + r * 0.28}" rx="${r * 1.04}" ry="${r * 0.95}" fill="#061a2455"/>` +
    body +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#ballLight)"/>` +
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

/** Draw in inches, with six separate cushions and recessed pocket wells.
 * Physical mouth widths are separate from solver acceptance widths.
 * ponytail: approximate jaws and shelves. Use measured profiles for exact replication.
 */
function tableBase(): string {
  const sideMouth = 5;
  const cornerEnd = CORNER_MOUTH / Math.SQRT2;
  const cushionDepth = 2;
  const cornerBack = cornerEnd - cushionDepth / Math.tan(38 * Math.PI / 180);
  const sideEnd = TABLE_W / 2 - sideMouth / 2;
  const sideBack = sideEnd + cushionDepth * Math.tan(14 * Math.PI / 180);
  const longCushion = `${cornerEnd},0 ${sideEnd},0 ${sideBack},-2 ${cornerBack},-2`;
  const shortCushion = `0,${cornerEnd} 0,${TABLE_H - cornerEnd} -2,${TABLE_H - cornerBack} -2,${cornerBack}`;
  const mouthCenter = cornerEnd / 2;
  const diagonal = 1 / Math.SQRT2;
  let s = `<g transform="translate(${RAIL * S} ${RAIL * S}) scale(${S})">`;
  s += `<rect x="-7" y="-7" width="${TABLE_W + 14}" height="${TABLE_H + 14}" rx="4" fill="url(#railFinish)" stroke="#435058" stroke-width="0.2"/>`;
  s += `<rect x="-6.5" y="-6.5" width="${TABLE_W + 13}" height="${TABLE_H + 13}" rx="3.6" fill="none" stroke="#080d10" stroke-width="0.3"/>`;
  s += `<rect x="-2" y="-2" width="${TABLE_W + 4}" height="${TABLE_H + 4}" fill="url(#cloth)"/>`;

  // Flush U-shaped liners and rounded wells, based on the reference photographs:
  // https://dlbilliards.com/cdn/shop/products/black_pockets.jpg?v=1616529623
  // https://dlbilliards.com/cdn/shop/products/black_side_pocket_4d89ab2f-7369-4643-9e25-df5f3f67d95a_1024x1024.jpg?v=1616533057
  // Draw them before the cushions so the cloth facings cover the liner ends.
  for (const y of [0, TABLE_H]) {
    const throat = TABLE_W / 2 - sideBack;
    const shelf = sideMouth / 2 - (sideBack - sideEnd) * 0.1;
    s += `<g transform="translate(${TABLE_W / 2} ${y}) scale(1 ${y ? -1 : 1})">`;
    s += `<path d="M -3.2,-1.8 L -3.2,-3.2 Q -3.2,-5.9 0,-5.9 Q 3.2,-5.9 3.2,-3.2 L 3.2,-1.8 Z" fill="url(#pocketLiner)" stroke="#41494d" stroke-width="0.12"/>`;
    s += `<path d="M -${shelf},-0.2 L -${throat},-2 L -${throat},-3.2 Q -${throat},-4.7 0,-4.7 Q ${throat},-4.7 ${throat},-3.2 L ${throat},-2 L ${shelf},-0.2 Z" fill="#030608" stroke="#111719" stroke-width="0.12"/>`;
    s += `</g>`;
  }

  // Mirror one pair of long cushions and one corner well into each quadrant.
  for (const x of [0, TABLE_W]) {
    for (const y of [0, TABLE_H]) {
      s += `<g transform="translate(${x} ${y}) scale(${x ? -1 : 1} ${y ? -1 : 1})">`;
      // In this frame, x spans the mouth and +y runs into the pocket.
      s += `<g transform="matrix(${diagonal} ${-diagonal} ${-diagonal} ${-diagonal} ${mouthCenter} ${mouthCenter})">`;
      s += `<path d="M -3.25,2.6 L -3.25,4.2 Q -3.25,7 0,7 Q 3.25,7 3.25,4.2 L 3.25,2.6 Z" fill="url(#pocketLiner)" stroke="#41494d" stroke-width="0.12"/>`;
      s += `<path d="M -2.15,1.5 Q 0,2.1 2.15,1.5 L 2.15,4.2 Q 2.15,5.9 0,5.9 Q -2.15,5.9 -2.15,4.2 Z" fill="#030608" stroke="#111719" stroke-width="0.12"/>`;
      s += `</g>`;
      s += `<polygon points="${longCushion}" fill="url(#cushion)" stroke="#1e5b72" stroke-width="0.12" stroke-linejoin="round"/>`;
      s += `<path d="M ${cornerEnd},0 H ${sideEnd}" fill="none" stroke="#75bbce" stroke-opacity="0.55" stroke-width="0.12"/>`;
      s += `</g>`;
    }
  }
  for (const x of [0, TABLE_W]) {
    s += `<g transform="translate(${x} 0) scale(${x ? -1 : 1} 1)">`;
    s += `<polygon points="${shortCushion}" fill="#26758e" stroke="#1e5b72" stroke-width="0.12" stroke-linejoin="round"/>`;
    s += `<path d="M 0,${cornerEnd} V ${TABLE_H - cornerEnd}" stroke="#75bbce" stroke-opacity="0.55" stroke-width="0.12"/>`;
    s += `</g>`;
  }
  const diamond = (x: number, y: number, rotation = 0) =>
    `<path transform="translate(${x} ${y}) rotate(${rotation})" d="M 0,-0.5 L 0.3,0 0,0.5 -0.3,0 Z" fill="#c4c8bd"/>`;
  for (let i = 1; i < 8; i++) {
    if (i === 4) continue;
    s += diamond(TABLE_W * i / 8, -4.4);
    s += diamond(TABLE_W * i / 8, TABLE_H + 4.4);
  }
  for (let i = 1; i < 4; i++) {
    s += diamond(-4.4, TABLE_H * i / 4, 90);
    s += diamond(TABLE_W + 4.4, TABLE_H * i / 4, 90);
  }
  s += `<circle cx="${TABLE_W * 3 / 4}" cy="${TABLE_H / 2}" r="0.22" fill="#d3ebee" fill-opacity="0.4"/>`;
  return s + `</g>`;
}

export function renderScene(scene: Scene): string {
  const w = (TABLE_W + 2 * RAIL) * S;
  const h = (TABLE_H + 2 * RAIL) * S;
  const defs =
    `<linearGradient id="pocketLiner" x2="0" y2="1"><stop stop-color="#272f33"/><stop offset="1" stop-color="#171e22"/></linearGradient>` +
    `<linearGradient id="railFinish" x2="0" y2="1"><stop stop-color="#303b41"/><stop offset="1" stop-color="#171f24"/></linearGradient>` +
    `<radialGradient id="cloth"><stop stop-color="#338daa"/><stop offset="1" stop-color="#2b809b"/></radialGradient>` +
    `<linearGradient id="cushion" x2="0" y2="1"><stop stop-color="#328ca5"/><stop offset="1" stop-color="#226980"/></linearGradient>` +
    `<radialGradient id="ballLight" cx="32%" cy="25%" r="75%"><stop stop-color="white" stop-opacity="0.45"/><stop offset="0.4" stop-color="white" stop-opacity="0"/><stop offset="1" stop-color="black" stop-opacity="0.25"/></radialGradient>` +
    `<marker id="arrowRoute" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#ffad86"/></marker>` +
    `<marker id="arrowPot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#fff8e8"/></marker>`;
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
      body += `<polygon points="${az.map(pt).join(' ')}" fill="rgba(190,190,178,0.22)" stroke="#a8c9d2" stroke-width="1.2" stroke-dasharray="4 4"/>`;
    }
  }
  for (const z of scene.zone) {
    if (z.length >= 3) {
      body += `<polygon points="${z.map(pt).join(' ')}" fill="rgba(255,216,77,0.22)" stroke="#f0d578" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    }
  }

  for (const gp of scene.ghostPaths) {
    if (gp.length >= 2) body += polyline(gp, `stroke="rgba(253,253,246,0.6)" stroke-width="2.2" stroke-dasharray="7 5"`);
  }

  const shot = scene.shot;
  if (shot) {
    // object ball -> pocket
    body += line(shot.ballPos, shot.pocketTarget, `stroke="#fff8e8" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#arrowPot)"`);
    // cue -> ghost
    body += line(shot.cuePos, shot.ghost, `stroke="rgba(253,253,246,0.85)" stroke-width="2"`);
    if (shot.path && shot.path.length >= 2) {
      body += polyline(shot.path, `stroke="#ffad86" stroke-width="2.6" marker-end="url(#arrowRoute)"`);
    }
    if (shot.landing) body += drawCueBall(shot.landing, true);
  }

  for (const b of scene.balls) body += drawBall(b);
  if (scene.cue) body += drawCueBall(scene.cue, false, scene.cueDraggable ?? false);

  return (
    `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Top-down nine-ball pool table"><title>Nine-ball practice table</title>` +
    `<defs>` +
    defs +
    `</defs>` +
    body +
    `</svg>`
  );
}
