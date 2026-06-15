import { Vec, vec } from './geometry';
import { SkillProfile } from './skill';
import { BALL_R, Layout, MAX_X, MAX_Y, MIN_X, MIN_Y } from './table';
import { legalCuePosition } from './interaction';
import { solveFromCue } from './solver';
import type { Pattern } from './solver';
import type { ValueSurface } from './value';

export const OPENING_VALIDITY_STEP = 2 * BALL_R;

export function openingSamplePoints(
  layout: Layout,
  step = OPENING_VALIDITY_STEP,
): Vec[] {
  const points: Vec[] = [];
  for (let y = MIN_Y; y <= MAX_Y + 1e-9; y += step) {
    for (let x = MIN_X; x <= MAX_X + 1e-9; x += step) {
      const p = vec(x, y);
      if (legalCuePosition(p, layout.balls)) points.push(p);
    }
  }
  return points;
}

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
