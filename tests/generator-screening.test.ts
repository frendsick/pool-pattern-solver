import { beforeEach, expect, it, vi } from 'vitest';
import { generatePuzzle } from '../src/generator';
import { INTERMEDIATE } from '../src/skill';
import { screenLayout, solve } from '../src/solver';

vi.mock('../src/solver', () => ({ screenLayout: vi.fn(), solve: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('uses full scores for acceptance and retains layouts with weak screening estimates', () => {
  const screen = vi.mocked(screenLayout);
  const full = vi.mocked(solve);
  screen.mockReturnValue(0).mockReturnValueOnce(1);
  // The optimistic screen fails full validation. A zero estimate remains eligible.
  full.mockReturnValueOnce(null).mockReturnValue({ shots: [], score: 0.5 });
  const puzzle = generatePuzzle(2024, 9, INTERMEDIATE)!;
  expect(full).toHaveBeenCalledTimes(2);
  expect(puzzle.layout).toBe(full.mock.calls[1][0]);
  expect(puzzle.pattern.score).toBe(0.5);
});

it('keeps the best full-score fallback when no candidate reaches the quality bar', () => {
  vi.mocked(screenLayout).mockReturnValue(1);
  const full = vi.mocked(solve)
    .mockReturnValueOnce({ shots: [], score: 0.02 })
    .mockReturnValue({ shots: [], score: 0.01 });
  const puzzle = generatePuzzle(2024, 9, INTERMEDIATE)!;
  expect(full.mock.calls.length).toBeGreaterThan(8);
  expect(puzzle.layout).toBe(full.mock.calls[0][0]);
  expect(puzzle.pattern.score).toBe(0.02);
  expect(full.mock.calls.slice(1).every(call => call[2] === 0.02)).toBe(true);
});
