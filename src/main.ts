import { INTERMEDIATE } from './skill';
import { generatePuzzle } from './generator';
import type { GeneratedPuzzle } from './generator';
import { Vec, dist } from './geometry';
import { BALL_R } from './table';
import { previewLegFromCue, solveFromCue } from './solver';
import type { Pattern, PlannedShot } from './solver';
import { originWindowForStep, sceneForStep } from './scene';
import { renderScene, svgToTablePoint, VIEW_H, VIEW_W } from './render';
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
  el.prev.disabled = step === 0;
  el.next.disabled = step === n + 1;
  el.restoreLine.disabled = !(drag?.kind === 'opening' || activePattern !== puzzle.pattern);
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
    clearStatus();
    step--;
    renderCurrent();
  }
});
el.next.addEventListener('click', () => {
  if (activePattern && step < activePattern.shots.length + 1) {
    clearStatus();
    step++;
    renderCurrent();
  }
});
el.restoreLine.addEventListener('click', () => {
  if (!puzzle) return;
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
