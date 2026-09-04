import { generatePuzzle } from './generator';
import { packPuzzle } from './generation';
import type { GenerationRequest } from './generation';

self.onmessage = ({ data }: MessageEvent<GenerationRequest>) => {
  const { seed, ballCount, skill } = data;
  const puzzle = generatePuzzle(seed, ballCount, skill);
  self.postMessage(puzzle ? packPuzzle(puzzle, skill) : null);
};
