import { Vec } from './geometry';
import { SkillProfile } from './skill';
import { Layout } from './table';
import { legalCuePosition } from './interaction';
import { solveFromCue } from './solver';
import type { Pattern } from './solver';
import type { ValueSurface } from './value';

export function openingPatternFromCue(
  layout: Layout,
  skill: SkillProfile,
  cue: Vec,
  surfaces?: (ValueSurface | null)[],
): Pattern | null {
  if (!legalCuePosition(cue, layout.balls)) return null;
  const pattern = solveFromCue(layout, skill, 0, cue, surfaces);
  return pattern && pattern.score > 0 ? pattern : null;
}
