import { INTERMEDIATE } from './skill';
import { generatePuzzle } from './generator';
import type { GeneratedPuzzle } from './generator';
import { Vec, dist } from './geometry';
import { BALL_R } from './table';
import { previewLegFromCue, solveFromCue } from './solver';
import type { Pattern, PlannedShot } from './solver';
import { originWindowForStep, sceneForStep } from './scene';
import { renderScene, svgToTablePoint, VIEW_H, VIEW_W } from './render';
import type { Scene } from './render';
import { buildPlayback } from './playback';
import type { ShotPlayback } from './playback';
import {
  clampCuePosition,
  legalCuePosition,
  pointInPolygons,
  wholeTablePolygon,
} from './interaction';
import { openingPatternFromCue } from './opening-validity';

const MIN_BALLS = 2;
const MAX_BALLS = 9;
const DEFAULT_BALLS = 3;

const el = {
  table: document.getElementById('table')!,
  caption: document.getElementById('caption')!,
  stepLabel: document.getElementById('stepLabel')!,
  score: document.getElementById('score')!,
  newLayout: document.getElementById('newLayout') as HTMLButtonElement,
  ballCount: document.getElementById('ballCount') as HTMLSelectElement,
  prev: document.getElementById('prev') as HTMLButtonElement,
  next: document.getElementById('next') as HTMLButtonElement,
  play: document.getElementById('play') as HTMLButtonElement,
  scrub: document.getElementById('scrub') as HTMLInputElement,
  restoreLine: document.getElementById('restoreLine') as HTMLButtonElement,
};

// Integer resolution of the scrub <input type="range">; its value maps to a
// fraction value/SCRUB_MAX of the shot's full duration, so the slider is
// decoupled from each shot's (varying) wall-clock length.
const SCRUB_MAX = 1000;

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

// Per-shot playback (issues #19, #20). A shot the user has begun watching: `pb`
// is the kinematic replay, `t` the current animation time (seconds). `playing`
// drives the rAF clock; when it is false the frame is FROZEN (paused, scrubbed,
// or rested on the leave) and the planning overlays are restored so the frozen
// frame can be read against the plan. `last` is the previous animated frame's
// timestamp, so pause/resume accumulates elapsed time instead of restarting.
// Null whenever the diagram is at rest on a planning step (no shot begun).
type Playback = {
  index: number;
  pb: ShotPlayback;
  t: number;
  playing: boolean;
  raf: number;
  last: number;
};
let playback: Playback | null = null;

function captionForStep(
  pattern: Pattern,
  s: number,
  openingPlacement: OpeningPlacement,
): string {
  if (s === 0) {
    return (
      `<strong>Ball in hand — your turn first.</strong> No cue ball yet: ` +
      `visualize your own pattern (pockets, routes, where you would place the ` +
      `cue ball), then press <em>Next</em> to see the solver's starting position.`
    );
  }
  if (s === 1) {
    const pct = Math.round(pattern.score * 100);
    if (openingPlacement === 'player') {
      return (
        `<strong>Player-placed Ball in Hand.</strong> Best run-out from your cue-ball placement ` +
        `(faint white paths). Estimated run-out probability: <strong>${pct}%</strong>. ` +
        `Step through the shots with <em>Next</em>.`
      );
    }
    return (
      `<strong>Ball in hand.</strong> The solver placed the cue ball and planned the full run-out ` +
      `(faint white paths). Estimated run-out probability: <strong>${pct}%</strong>. ` +
      `Step through the shots with <em>Next</em>.`
    );
  }
  const shot = pattern.shots[s - 2];
  return `<strong>Shot ${s - 1}.</strong> ${shot.explanation}`;
}

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
        : {},
  );
  el.table.innerHTML = renderScene(scene);
  if (drag?.kind === 'alternative') {
    const reach = drag.preview?.eNext ?? null;
    el.caption.innerHTML =
      reach === null
        ? `<strong>Alternative leave.</strong> No route to the shown Position Window from this cue position.`
        : `<strong>Alternative leave.</strong> Best live route reaches the shown Position Window about <strong>${Math.round(reach * 100)}%</strong> of the time.`;
  } else if (drag?.kind === 'opening') {
    el.caption.innerHTML =
      `<strong>Ball in hand.</strong> Release the cue ball to solve from this exact placement.`;
  } else if (statusCaption) {
    el.caption.innerHTML = statusCaption;
  } else {
    el.caption.innerHTML = captionForStep(activePattern, step, activeOpeningPlacement);
  }
  el.stepLabel.textContent =
    step === 0 ? 'Layout' : step === 1 ? 'Overview' : `Shot ${step - 1} of ${n}`;
  const reach = drag?.kind === 'alternative' ? drag.preview?.eNext ?? null : null;
  el.score.textContent =
    `Run-out ~${Math.round(activePattern.score * 100)}%` +
    (reach === null ? '' : ` · leg reach ~${Math.round(reach * 100)}%`);
  updateControls();
}

// Button enabled-state, factored out so the playback loop can restore it
// without re-rendering (which would repaint planning overlays over a play frame).
function updateControls(): void {
  if (!puzzle || !activePattern) return;
  const n = activePattern.shots.length;
  const playing = playback?.playing ?? false;
  const onShot = currentShotIndex() !== null;
  // Stepping is locked only during ACTIVE play; while paused/scrubbing the user
  // can still step away (which exits playback).
  el.prev.disabled = playing || step === 0;
  el.next.disabled = playing || step === n + 1;
  // Play/Pause and the scrub are present always but inert off shot steps
  // (layout/overview). The Play button doubles as the pause toggle.
  el.play.disabled = !onShot;
  el.play.innerHTML = playing ? '&#10073;&#10073; Pause' : '&#9658; Play';
  el.scrub.disabled = !onShot;
  if (!playback) el.scrub.value = '0';
  el.newLayout.disabled = playing;
  el.ballCount.disabled = playing;
  el.restoreLine.disabled =
    playing || !(drag?.kind === 'opening' || activePattern !== puzzle.pattern);
}

function clearStatus(): void {
  statusCaption = null;
}

function showStatus(message: string): void {
  statusCaption = message;
  renderCurrent();
}

function newPuzzle(seed: number): void {
  const ballCount = selectedBallCount();
  stopPlayback();
  clearStatus();
  el.caption.textContent = 'Generating layout…';
  el.newLayout.disabled = true;
  window.location.hash = `s=${seed}&n=${ballCount}`;
  setTimeout(() => {
    puzzle = generatePuzzle(seed, ballCount, INTERMEDIATE);
    activePattern = puzzle?.pattern ?? null;
    activeOpeningPlacement = 'solver';
    step = 0;
    drag = null;
    el.newLayout.disabled = false;
    if (!puzzle) {
      el.caption.textContent = 'Could not generate a runnable layout — try again.';
      return;
    }
    renderCurrent();
  }, 20);
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

// A FROZEN playback frame WITH the planning overlays restored: this shot's
// planning diagram (window, arrows, ghost, landing marker) with the balls and
// cue moved to their animated positions at the current `t`. Used while paused,
// scrubbing, or rested on the leave, so the frozen frame reads against the plan.
function frozenScene(index: number, cue: Vec, object: Vec | null): Scene {
  if (!puzzle || !activePattern) throw new Error('frozenScene without a puzzle');
  const base = sceneForStep(puzzle.layout, activePattern, index + 2, INTERMEDIATE);
  const remaining = puzzle.layout.balls.slice(index);
  const shotBall = remaining[0];
  const rest = remaining.slice(1);
  return {
    ...base,
    balls: object ? [{ ...shotBall, pos: object }, ...rest] : rest,
    cue,
    cueDraggable: false,
  };
}

// Paint the current playback frame: overlays suppressed while actively playing,
// restored (frozenScene) when frozen. Also keep the scrub in sync with `t`.
function renderPlaybackFrame(): void {
  if (!playback) return;
  const st = playback.pb.at(playback.t);
  const scene = playback.playing
    ? playbackScene(playback.index, st.cue, st.object)
    : frozenScene(playback.index, st.cue, st.object);
  el.table.innerHTML = renderScene(scene);
  const frac = playback.pb.duration > 0 ? playback.t / playback.pb.duration : 0;
  el.scrub.value = String(Math.round(frac * SCRUB_MAX));
}

function playbackTick(ts: number): void {
  if (!playback || !playback.playing) return;
  if (playback.last < 0) playback.last = ts;
  playback.t = Math.min(playback.pb.duration, playback.t + (ts - playback.last) / 1000);
  playback.last = ts;
  if (playback.t >= playback.pb.duration) {
    pausePlayback(); // reached the leave — settle frozen at rest, overlays back
    return;
  }
  renderPlaybackFrame();
  playback.raf = requestAnimationFrame(playbackTick);
}

// Begin watching the current shot, lazily building its replay. Null off a shot.
function ensurePlayback(): Playback | null {
  if (playback) return playback;
  if (!activePattern) return null;
  const index = currentShotIndex();
  if (index === null) return null;
  playback = { index, pb: buildPlayback(activePattern.shots[index]), t: 0, playing: false, raf: 0, last: -1 };
  return playback;
}

function play(): void {
  clearStatus();
  const p = ensurePlayback();
  if (!p) return;
  if (p.t >= p.pb.duration) p.t = 0; // replay from the top once rested on the leave
  p.playing = true;
  p.last = -1;
  updateControls();
  renderPlaybackFrame(); // hide overlays immediately
  p.raf = requestAnimationFrame(playbackTick);
}

// Stop the rAF clock and mark the frame frozen, WITHOUT rendering — the single
// source of truth for "stop the clock". Callers render at the `t` they want
// (pausePlayback at the current `t`, scrubTo at the dragged `t`).
function freezeClock(p: Playback): void {
  if (p.raf) cancelAnimationFrame(p.raf);
  p.raf = 0;
  p.playing = false;
}

function pausePlayback(): void {
  if (!playback) return;
  freezeClock(playback);
  updateControls();
  renderPlaybackFrame(); // frozen frame, overlays restored
}

function togglePlay(): void {
  if (playback?.playing) pausePlayback();
  else play();
}

// Drag the timeline to any moment: pauses if playing, then drives `t` directly
// and re-renders the frozen frame there (mid-carom, at a rebound, the leave…).
function scrubTo(frac: number): void {
  clearStatus();
  const p = ensurePlayback();
  if (!p) return;
  freezeClock(p);
  p.t = Math.max(0, Math.min(1, frac)) * p.pb.duration;
  updateControls();
  renderPlaybackFrame();
}

// Exit playback entirely, back to the at-rest planning diagram. The caller is
// responsible for the follow-up renderCurrent().
function stopPlayback(): void {
  if (!playback) return;
  if (playback.raf) cancelAnimationFrame(playback.raf);
  playback = null;
}

function pointerToTable(e: PointerEvent): Vec | null {
  const svg = el.table.querySelector('svg');
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const svgX = ((e.clientX - rect.left) * VIEW_W) / rect.width;
  const svgY = ((e.clientY - rect.top) * VIEW_H) / rect.height;
  return svgToTablePoint({ x: svgX, y: svgY });
}

function currentObjectBalls(index: number) {
  return puzzle ? puzzle.layout.balls.slice(index) : [];
}

function previewForCue(index: number, cue: Vec): PlannedShot | null {
  if (!puzzle || !activePattern) return null;
  const targetZone = activePattern.shots[index]?.zone;
  if (!targetZone) return null;
  return previewLegFromCue(puzzle.layout, INTERMEDIATE, index, cue, targetZone);
}

function clampedAlternativeCue(index: number, p: Vec, originZone: Vec[][]): Vec {
  return clampCuePosition(p, originZone, currentObjectBalls(index));
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

function openingCueIsVisible(): boolean {
  return step === 1 || step === 2;
}

function pointerHitsOpeningCue(p: Vec): boolean {
  if (!activePattern || !openingCueIsVisible()) return false;
  return dist(p, activePattern.shots[0].cuePos) <= BALL_R * 2.2;
}

function commitOpeningCue(cue: Vec, targetStep: number): boolean {
  if (!puzzle) return false;
  // When a cue ball is already placed (a drag), a rejected spot snaps it back
  // to where the drag started; at step 0 there is no prior spot to return to.
  const returned = step !== 0 ? ' — cue ball returned to its previous spot' : '';
  if (!legalCuePosition(cue, puzzle.layout.balls)) {
    showStatus(`<strong>Invalid placement.</strong> The cue ball overlaps another ball${returned}.`);
    return false;
  }
  const pattern = openingPatternFromCue(puzzle.layout, INTERMEDIATE, cue);
  if (!pattern) {
    showStatus(`<strong>Invalid placement.</strong> No complete run-out from there${returned}.`);
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
  if (playback) return; // cue dragging is off while a shot is being watched
  if (!puzzle || !activePattern || e.button !== 0) return;
  const p = pointerToTable(e);
  if (!p) return;
  clearStatus();

  if (step === 0) {
    commitOpeningCue(p, 1);
    e.preventDefault();
    return;
  }

  if (pointerHitsOpeningCue(p)) {
    startOpeningDrag(e);
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
el.prev.addEventListener('click', () => {
  if (step > 0) {
    stopPlayback();
    clearStatus();
    step--;
    renderCurrent();
  }
});
el.next.addEventListener('click', () => {
  if (activePattern && step < activePattern.shots.length + 1) {
    stopPlayback();
    clearStatus();
    step++;
    renderCurrent();
  }
});
el.play.addEventListener('click', () => {
  togglePlay();
});
el.scrub.addEventListener('input', () => {
  if (el.scrub.disabled) return;
  scrubTo(Number(el.scrub.value) / SCRUB_MAX);
});
el.restoreLine.addEventListener('click', () => {
  if (!puzzle) return;
  stopPlayback();
  activePattern = puzzle.pattern;
  activeOpeningPlacement = 'solver';
  drag = null;
  clearStatus();
  if (step > activePattern.shots.length + 1) step = activePattern.shots.length + 1;
  renderCurrent();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') el.prev.click();
  if (e.key === 'ArrowRight') el.next.click();
});

const hashSeed = /s=(\d+)/.exec(window.location.hash)?.[1];
const hashBalls = /n=(\d+)/.exec(window.location.hash)?.[1];
if (hashBalls) {
  const n = Number(hashBalls);
  if (n >= MIN_BALLS && n <= MAX_BALLS) el.ballCount.value = String(n);
}
newPuzzle(hashSeed ? Number(hashSeed) : Math.floor(Math.random() * 1e9));
