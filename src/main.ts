import { INTERMEDIATE } from './skill';
import type { GeneratedPuzzle } from './generator';
import { unpackPuzzle } from './generation';
import type { GenerationRequest, PuzzleMessage } from './generation';
import { Vec, dist } from './geometry';
import { BALL_R, TABLE_W, TABLE_H } from './table';
import { previewLegFromCue, solveFromCue } from './solver';
import type { Pattern, PlannedShot } from './solver';
import { originWindowForStep, sceneForStep } from './scene';
import { renderScene, svgToTablePoint } from './render';
import type { Scene } from './render';
import { buildPlayback } from './playback';
import type { ShotPlayback } from './playback';
import {
  clampCuePosition,
  legalCuePosition,
  pointInPolygons,
  wholeTablePolygon,
} from './interaction';

const MIN_BALLS = 2;
const MAX_BALLS = 9;
const DEFAULT_BALLS = 3;

const el = {
  table: document.getElementById('table')!,
  caption: document.getElementById('caption')!,
  stepLabel: document.getElementById('stepLabel')!,
  balls: document.getElementById('balls')!,
  shotSelection: document.getElementById('shotSelection')!,
  playbackControls: document.getElementById('playbackControls')!,
  reveal: document.getElementById('reveal') as HTMLButtonElement,
  hide: document.getElementById('hide') as HTMLButtonElement,
  overview: document.getElementById('overview') as HTMLButtonElement,
  newLayout: document.getElementById('newLayout') as HTMLButtonElement,
  ballCount: document.getElementById('ballCount') as HTMLSelectElement,
  prev: document.getElementById('prev') as HTMLButtonElement,
  next: document.getElementById('next') as HTMLButtonElement,
  play: document.getElementById('play') as HTMLButtonElement,
  restoreLine: document.getElementById('restoreLine') as HTMLButtonElement,
};

type OpeningPlacement = 'solver' | 'player';

type OpeningDrag = {
  kind: 'opening';
  pointerId: number;
  cue: Vec;
  startCue: Vec;
};

type AlternativeDrag = {
  kind: 'alternative';
  pointerId: number;
  cue: Vec;
  preview: PlannedShot | null;
  originZone: Vec[][];
};

type DragState = OpeningDrag | AlternativeDrag;

function selectedBallCount(): number {
  const n = Number(el.ballCount.value);
  return Math.min(MAX_BALLS, Math.max(MIN_BALLS, Number.isFinite(n) ? n : DEFAULT_BALLS));
}

let puzzle: GeneratedPuzzle | null = null;
let activePattern: Pattern | null = null;
let activeOpeningPlacement: OpeningPlacement = 'solver';
let step = 0; // 0 = first-look layout, 1 = overview, 2..N+1 = shots
let drag: DragState | null = null;
let statusCaption: string | null = null;
let generationWorker: Worker | null = null;
let playbackFinished = false;

// Per-shot real-time playback (issue #19): a rAF loop walks playback.ts and
// rebuilds a bare Scene per frame. Null whenever the diagram is at rest.
type PlayState = { index: number; pb: ShotPlayback; start: number; raf: number };
let playState: PlayState | null = null;

function renderCurrent(): void {
  if (!puzzle || !activePattern) return;
  const n = activePattern.shots.length;
  const scene = sceneForStep(
    puzzle.layout,
    activePattern,
    step,
    INTERMEDIATE,
    drag?.kind === 'alternative'
      ? { cue: drag.cue, previewShot: drag.preview, highlightOriginZone: true }
      : drag?.kind === 'opening'
        ? { cue: drag.cue, suppressPattern: true }
        : step === 0 && activeOpeningPlacement === 'player'
          ? { cue: activePattern.shots[0].cuePos }
          : {},
  );
  el.table.innerHTML = renderScene(scene);
  el.caption.textContent = statusCaption ?? '';
  el.stepLabel.textContent =
    step === 0 ? 'Place the cue ball or reveal the pattern' : step === 1 ? 'Whole pattern' : `Shot ${step - 1} of ${n}, ball ${activePattern.shots[step - 2].ball.num}`;
  updateControls();
}

// Button enabled-state, factored out so stopPlayback can restore it without
// re-rendering (which would repaint planning overlays over the frozen leave).
function updateControls(): void {
  const unavailable = !puzzle || !activePattern;
  const n = activePattern?.shots.length ?? 0;
  const playing = playState !== null;
  const inShot = currentShotIndex() !== null;
  el.shotSelection.hidden = unavailable || step === 0;
  el.playbackControls.hidden = !inShot;
  el.reveal.hidden = inShot;
  el.reveal.disabled = unavailable || drag !== null;
  el.reveal.textContent = step === 1 ? 'First shot' : 'Reveal';
  el.prev.disabled = !inShot || drag !== null || step <= 2;
  el.next.disabled = !inShot || drag !== null || step >= n + 1;
  el.play.disabled = !inShot || drag !== null;
  el.play.textContent = playbackFinished ? 'Again' : playing ? '■' : '▶';
  el.play.classList.toggle('finished', playbackFinished);
  const playLabel = playbackFinished ? 'Practice again' : playing ? 'Stop replay' : 'Play shot and advance';
  el.play.setAttribute('aria-label', playLabel);
  el.play.title = playLabel;
  el.restoreLine.hidden = unavailable || step >= 2 || activePattern === puzzle?.pattern;
  el.restoreLine.disabled = drag !== null;
  el.hide.disabled = drag !== null;
  el.overview.disabled = drag !== null;
  el.overview.classList.toggle('selected', step === 1);
  el.overview.setAttribute('aria-pressed', String(step === 1));
  for (const button of el.balls.querySelectorAll<HTMLButtonElement>('button')) {
    const selected = Number(button.dataset.step) === step;
    button.classList.toggle('selected', selected);
    if (selected) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    button.disabled = drag !== null;
  }
}

function goToStep(target: number): void {
  if (!activePattern || drag) return;
  const focused = document.activeElement;
  stopPlayback();
  playbackFinished = false;
  clearStatus();
  step = Math.max(0, Math.min(target, activePattern.shots.length + 1));
  renderCurrent();
  if (focused instanceof HTMLElement && focused.closest('[hidden]')) {
    (step < 2 ? el.reveal : el.play).focus({ preventScroll: true });
  }
  const selected = el.balls.querySelector<HTMLElement>('[aria-current="step"]');
  selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function clearStatus(): void {
  statusCaption = null;
  el.caption.textContent = '';
}

function showStatus(message: string): void {
  statusCaption = message;
  renderCurrent();
}

function newPuzzle(seed: number): void {
  const ballCount = selectedBallCount();
  generationWorker?.terminate();
  generationWorker = null;
  stopPlayback();
  playbackFinished = false;
  clearStatus();
  if (drag) el.table.releasePointerCapture(drag.pointerId);
  drag = null;
  puzzle = null;
  activePattern = null;
  activeOpeningPlacement = 'solver';
  step = 0;
  el.table.replaceChildren();
  el.table.setAttribute('aria-busy', 'true');
  el.stepLabel.textContent = '';
  el.balls.replaceChildren();
  el.caption.textContent = 'Generating layout';
  updateControls();
  window.location.hash = `s=${seed}&n=${ballCount}`;
  try {
    const worker = new Worker(new URL('./generator.worker.ts', import.meta.url), { type: 'module' });
    generationWorker = worker;
    worker.onmessage = ({ data }: MessageEvent<PuzzleMessage | null>) => {
      if (generationWorker !== worker) return;
      finishGeneration(data ? unpackPuzzle(data, INTERMEDIATE) : null);
    };
    const fail = () => {
      if (generationWorker === worker) finishGeneration(null);
    };
    worker.addEventListener('error', fail);
    worker.addEventListener('messageerror', fail);
    worker.postMessage({ seed, ballCount, skill: INTERMEDIATE } satisfies GenerationRequest);
  } catch {
    finishGeneration(null);
  }
}

function finishGeneration(result: GeneratedPuzzle | null): void {
  generationWorker?.terminate();
  generationWorker = null;
  puzzle = result;
  activePattern = puzzle?.pattern ?? null;
  el.table.setAttribute('aria-busy', 'false');
  updateControls();
  if (!puzzle) {
    el.caption.textContent = 'Could not generate a runnable layout. Try again.';
    return;
  }
  for (const [i, shot] of puzzle.pattern.shots.entries()) {
    const button = document.createElement('button');
    button.className = 'shot-link';
    button.dataset.step = String(i + 2);
    button.setAttribute('aria-label', `Shot ${i + 1}, ball ${shot.ball.num}`);
    button.innerHTML = `<span class="ball-chip ball-${shot.ball.num}">${shot.ball.num}</span>`;
    button.addEventListener('click', () => goToStep(i + 2));
    el.balls.append(button);
  }
  renderCurrent();
}

function currentShotIndex(): number | null {
  if (!activePattern || step < 2 || step > activePattern.shots.length + 1) return null;
  return step - 2;
}

// A bare Scene for one playback frame: balls at their animated positions, cue
// at its animated position, and every planning overlay (window, arrows, ghost,
// landing marker, faint paths) suppressed. Builds the Scene here rather than in
// scene.ts so scene.ts/render.ts stay free of any animation concept and the
// snapshot tool is unaffected.
function playbackScene(index: number, cue: Vec, object: Vec | null): Scene {
  if (!puzzle) throw new Error('playbackScene without a puzzle');
  // layout.balls.slice(index): the ball being shot first, then the rest.
  const remaining = puzzle.layout.balls.slice(index);
  const shotBall = remaining[0];
  const rest = remaining.slice(1);
  const balls = object ? [{ ...shotBall, pos: object }, ...rest] : rest;
  return {
    balls,
    originZone: [],
    zone: [],
    altZones: [],
    shot: null,
    ghostPaths: [],
    cue,
    cueDraggable: false,
  };
}

function playbackFrame(ts: number): void {
  if (!playState) return;
  if (playState.start < 0) playState.start = ts;
  const t = (ts - playState.start) / 1000;
  const st = playState.pb.at(t);
  el.table.innerHTML = renderScene(playbackScene(playState.index, st.cue, st.object));
  if (st.done) {
    finishPlayback(); // advance to the next shot, or freeze on the final leave
    return;
  }
  playState.raf = requestAnimationFrame(playbackFrame);
}

// A shot's video has played out. Advance to the next shot's static planning
// diagram and wait for another Play; the final shot has no next shot, so it
// stays frozen on the leave just rendered.
function finishPlayback(): void {
  if (!playState || !activePattern) return;
  cancelAnimationFrame(playState.raf);
  const index = playState.index;
  playState = null;
  const isLastShot = index >= activePattern.shots.length - 1;
  if (isLastShot) {
    playbackFinished = true;
    el.stepLabel.textContent = 'Rack complete';
    updateControls(); // Keep the cleared table until the player navigates.
  } else {
    goToStep(step + 1);
  }
}

function startPlayback(): void {
  if (playState || !activePattern) return;
  const index = currentShotIndex();
  if (index === null) return;
  clearStatus();
  playState = {
    index,
    pb: buildPlayback(activePattern.shots[index]),
    start: -1,
    raf: 0,
  };
  updateControls();
  playState.raf = requestAnimationFrame(playbackFrame);
}

function stopPlayback(): void {
  if (!playState) return;
  cancelAnimationFrame(playState.raf);
  playState = null;
  updateControls();
}

function pointerToTable(e: PointerEvent): Vec | null {
  const svg = el.table.querySelector('svg');
  if (!svg) return null;
  // Includes CSS rotation and scaling, so portrait touch uses the same mapping.
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const local = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return svgToTablePoint({ x: local.x, y: local.y });
}

function previewForCue(index: number, cue: Vec): PlannedShot | null {
  if (!puzzle || !activePattern) return null;
  const targetZone = activePattern.shots[index]?.zone;
  if (!targetZone) return null;
  return previewLegFromCue(puzzle.layout, INTERMEDIATE, index, cue, targetZone);
}

function clampedAlternativeCue(index: number, p: Vec, originZone: Vec[][]): Vec {
  return clampCuePosition(p, originZone, puzzle ? puzzle.layout.balls.slice(index) : []);
}

function clampedOpeningCue(p: Vec): Vec {
  return puzzle ? clampCuePosition(p, [wholeTablePolygon()], puzzle.layout.balls) : p;
}

function continuationPrefix(index: number): number {
  if (!puzzle || !activePattern) return 1;
  const currentCue = activePattern.shots[index]?.cuePos;
  if (!currentCue) return 1;
  const base = solveFromCue(puzzle.layout, INTERMEDIATE, index, currentCue);
  if (!base || base.score <= 0) return 1;
  return activePattern.score / base.score;
}

function pointerHitsOpeningCue(p: Vec): boolean {
  if (!activePattern || step > 2 || (step === 0 && activeOpeningPlacement !== 'player')) return false;
  return dist(p, activePattern.shots[0].cuePos) <= BALL_R * 2.2;
}

function commitOpeningCue(cue: Vec, targetStep: number): boolean {
  if (!puzzle) return false;
  const returned = step !== 0 || activeOpeningPlacement === 'player'
    ? '. Cue ball returned to its previous spot' : '';
  if (!legalCuePosition(cue, puzzle.layout.balls)) {
    showStatus(`Place the cue ball on the cloth, clear of other balls${returned}.`);
    return false;
  }
  const pattern = solveFromCue(puzzle.layout, INTERMEDIATE, 0, cue);
  if (!pattern || pattern.score <= 0) {
    showStatus(`No complete run-out from there${returned}.`);
    return false;
  }
  activePattern = pattern;
  activeOpeningPlacement = 'player';
  step = Math.min(targetStep, activePattern.shots.length + 1);
  clearStatus();
  renderCurrent();
  return true;
}

function finishOpeningDrag(d: OpeningDrag): void {
  drag = null;
  if (dist(d.cue, d.startCue) < 0.01) {
    renderCurrent();
    return;
  }
  commitOpeningCue(d.cue, step);
}

function finishAlternativeDrag(d: AlternativeDrag): void {
  if (!puzzle || !activePattern) {
    drag = null;
    return;
  }
  const index = currentShotIndex();
  if (index === null) {
    drag = null;
    renderCurrent();
    return;
  }
  const cue = d.cue;
  const prefix = continuationPrefix(index);
  const suffix = solveFromCue(puzzle.layout, INTERMEDIATE, index, cue);
  if (!suffix) {
    if (pointInPolygons(cue, d.originZone)) {
      console.warn('Position Window render-vs-scoring seam: in-window Alternative Leave produced no continuing route', {
        seed: puzzle.layout.seed,
        shot: index + 1,
        cue,
      });
    }
    drag = null;
    renderCurrent();
    return;
  }
  activePattern = {
    shots: [...activePattern.shots.slice(0, index), ...suffix.shots],
    score: Math.max(0, Math.min(1, prefix * suffix.score)),
  };
  drag = null;
  clearStatus();
  renderCurrent();
}

function startOpeningDrag(e: PointerEvent): void {
  if (!activePattern) return;
  const cue = activePattern.shots[0].cuePos;
  drag = {
    kind: 'opening',
    pointerId: e.pointerId,
    cue,
    startCue: cue,
  };
  el.table.setPointerCapture(e.pointerId);
  e.preventDefault();
  renderCurrent();
}

function startAlternativeDrag(e: PointerEvent, index: number, p: Vec): void {
  if (!activePattern) return;
  const cue = activePattern.shots[index].cuePos;
  if (dist(p, cue) > BALL_R * 2.2) return;
  const originZone = originWindowForStep(activePattern, step, INTERMEDIATE);
  if (originZone.length === 0) return;
  const clamped = clampedAlternativeCue(index, p, originZone);
  drag = {
    kind: 'alternative',
    pointerId: e.pointerId,
    cue: clamped,
    preview: previewForCue(index, clamped),
    originZone,
  };
  el.table.setPointerCapture(e.pointerId);
  e.preventDefault();
  renderCurrent();
}

el.table.addEventListener('pointerdown', (e) => {
  if (playState || playbackFinished || drag) return;
  if (!puzzle || !activePattern || e.button !== 0) return;
  const p = pointerToTable(e);
  if (!p) return;
  clearStatus();

  if (pointerHitsOpeningCue(p)) {
    startOpeningDrag(e);
    return;
  }

  if (step === 0) {
    commitOpeningCue(p, 0);
    e.preventDefault();
    return;
  }

  const index = currentShotIndex();
  if (index === null) return;
  startAlternativeDrag(e, index, p);
});

el.table.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const p = pointerToTable(e);
  if (!p) return;
  if (drag.kind === 'opening') {
    drag.cue = clampedOpeningCue(p);
  } else {
    const index = currentShotIndex();
    if (index === null) return;
    drag.cue = clampedAlternativeCue(index, p, drag.originZone);
    drag.preview = previewForCue(index, drag.cue);
  }
  renderCurrent();
});

el.table.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  el.table.releasePointerCapture(e.pointerId);
  const finished = drag;
  if (finished.kind === 'opening') finishOpeningDrag(finished);
  else finishAlternativeDrag(finished);
});

el.table.addEventListener('pointercancel', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag = null;
  renderCurrent();
});

el.newLayout.addEventListener('click', () => {
  newPuzzle(Math.floor(Math.random() * 1e9));
});
el.ballCount.addEventListener('change', () => {
  newPuzzle(Math.floor(Math.random() * 1e9));
});
el.prev.addEventListener('click', () => goToStep(Math.max(2, step - 1)));
el.next.addEventListener('click', () => goToStep(step + 1));
el.reveal.addEventListener('click', () => goToStep(2));
el.hide.addEventListener('click', () => goToStep(0));
el.overview.addEventListener('click', () => goToStep(1));
el.play.addEventListener('click', () => {
  if (playbackFinished) goToStep(0);
  else if (playState) goToStep(step);
  else startPlayback();
});
el.restoreLine.addEventListener('click', () => {
  if (!puzzle || drag) return;
  activePattern = puzzle.pattern;
  activeOpeningPlacement = 'solver';
  goToStep(step);
});
window.addEventListener('keydown', (e) => {
  if ((e.target as Element).closest('input, textarea, select, [contenteditable]')) return;
  if (e.target === el.table && step === 0 && puzzle && activePattern && !drag) {
    const moves: Record<string, Vec> = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, Enter: { x: 0, y: 0 },
    };
    const move = moves[e.key];
    const ctm = el.table.querySelector('svg')?.getScreenCTM();
    if (move && ctm) {
      e.preventDefault();
      // Map screen directions into table directions, including portrait rotation.
      const local = new DOMPoint(move.x, move.y, 0, 0).matrixTransform(ctm.inverse());
      const scale = (e.shiftKey ? 0.25 : 1) / (Math.hypot(local.x, local.y) || 1);
      const cue = activeOpeningPlacement === 'player'
        ? activePattern.shots[0].cuePos : { x: TABLE_W / 2, y: TABLE_H / 2 };
      commitOpeningCue(clampedOpeningCue({ x: cue.x + local.x * scale, y: cue.y - local.y * scale }), 0);
      return;
    }
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    (e.key === 'ArrowLeft' ? el.prev : el.next).click();
  }
});

const hash = new URLSearchParams(window.location.hash.slice(1));
const hashSeed = hash.get('s');
const hashBalls = hash.get('n');
if (hashBalls) {
  const n = Number(hashBalls);
  if (n >= MIN_BALLS && n <= MAX_BALLS) el.ballCount.value = String(n);
}
newPuzzle(hashSeed ? Number(hashSeed) : Math.floor(Math.random() * 1e9));
