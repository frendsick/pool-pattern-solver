import type { GeneratedPuzzle } from './generator';
import type { SkillProfile } from './skill';
import { restoreSurfaces, surfacesForLayout, zoneInputsForBall } from './value';
import type { ValueSurfaceData } from './value';

export interface GenerationRequest {
  seed: number;
  ballCount: number;
  skill: SkillProfile;
}

export interface PuzzleMessage {
  puzzle: GeneratedPuzzle;
  surfaces: (ValueSurfaceData | null)[];
}

/** Send resolved zones and their grids, omitting only the lookup functions. */
export function packPuzzle(puzzle: GeneratedPuzzle, skill: SkillProfile): PuzzleMessage {
  return {
    puzzle: {
      ...puzzle,
      pattern: {
        ...puzzle.pattern,
        shots: puzzle.pattern.shots.map((shot) => ({
          ...shot,
          zone: shot.zone ? { ...shot.zone, nextValue: undefined } : null,
        })),
      },
    },
    surfaces: surfacesForLayout(puzzle.layout, skill).map((surface) => {
      if (!surface) return null;
      const { at, ...data } = surface;
      return data;
    }),
  };
}

/** Restore gates without repeating the backward pass or changing resolved zones. */
export function unpackPuzzle(
  { puzzle, surfaces: data }: PuzzleMessage,
  skill: SkillProfile,
): GeneratedPuzzle {
  const surfaces = restoreSurfaces(puzzle.layout, skill, data);
  puzzle.pattern.shots.forEach((shot, index) => {
    if (shot.zone) {
      shot.zone.nextValue = zoneInputsForBall(puzzle.layout.balls, index + 1, surfaces).gate;
    }
  });
  return puzzle;
}
