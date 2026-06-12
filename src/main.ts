import { INTERMEDIATE } from './skill';
import { generatePuzzle, GeneratedPuzzle } from './generator';
import { Pattern } from './solver';
import { sceneForStep } from './scene';
import { renderScene } from './render';

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
};

function selectedBallCount(): number {
  const n = Number(el.ballCount.value);
  return Math.min(MAX_BALLS, Math.max(MIN_BALLS, Number.isFinite(n) ? n : DEFAULT_BALLS));
}

let puzzle: GeneratedPuzzle | null = null;
let step = 0; // 0 = overview, 1..N = shots

function captionForStep(pattern: Pattern, s: number): string {
  if (s === 0) {
    return (
      `<strong>Ball in hand — your turn first.</strong> No cue ball yet: ` +
      `visualize your own pattern (pockets, routes, where you would place the ` +
      `cue ball), then press <em>Next</em> to see the solver's starting position.`
    );
  }
  if (s === 1) {
    const pct = Math.round(pattern.score * 100);
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
  if (!puzzle) return;
  const n = puzzle.pattern.shots.length;
  el.table.innerHTML = renderScene(
    sceneForStep(puzzle.layout, puzzle.pattern, step, INTERMEDIATE),
  );
  el.caption.innerHTML = captionForStep(puzzle.pattern, step);
  el.stepLabel.textContent =
    step === 0 ? 'Layout' : step === 1 ? 'Overview' : `Shot ${step - 1} of ${n}`;
  el.score.textContent = `Run-out ~${Math.round(puzzle.pattern.score * 100)}%`;
  el.prev.disabled = step === 0;
  el.next.disabled = step === n + 1;
}

function newPuzzle(seed: number): void {
  const ballCount = selectedBallCount();
  el.caption.textContent = 'Generating layout…';
  el.newLayout.disabled = true;
  window.location.hash = `s=${seed}&n=${ballCount}`;
  setTimeout(() => {
    puzzle = generatePuzzle(seed, ballCount, INTERMEDIATE);
    step = 0;
    el.newLayout.disabled = false;
    if (!puzzle) {
      el.caption.textContent = 'Could not generate a runnable layout — try again.';
      return;
    }
    renderCurrent();
  }, 20);
}

el.newLayout.addEventListener('click', () => {
  newPuzzle(Math.floor(Math.random() * 1e9));
});
el.ballCount.addEventListener('change', () => {
  newPuzzle(Math.floor(Math.random() * 1e9));
});
el.prev.addEventListener('click', () => {
  if (step > 0) { step--; renderCurrent(); }
});
el.next.addEventListener('click', () => {
  if (puzzle && step < puzzle.pattern.shots.length + 1) { step++; renderCurrent(); }
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
