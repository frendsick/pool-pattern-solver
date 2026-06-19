// Human-readable shot explanations for the UI. Turns a PlannedShot into a
// one-sentence description of the pocket, route, and position play.

import { dist } from './geometry';
import { ShotType, Sidespin } from './shots';
import { SkillProfile, distanceSigma } from './skill';
import type { PlannedShot } from './solver';

const pct = (v: number) => `${Math.min(99, Math.round(v * 100))}%`;

function typePhrase(type: ShotType): string {
  switch (type) {
    case 'stop': return 'Stop shot';
    case 'follow': return 'A natural rolling follow';
    case 'stun': return 'A stun off the tangent line';
    case 'lowTouch': return 'A touch of low (slight draw)';
    case 'draw': return 'A draw';
  }
}

function railsPhrase(rails: number): string {
  if (rails === 0) return '';
  if (rails === 1) return ' off one rail';
  return ` off ${rails === 2 ? 'two' : 'three'} rails`;
}

function spinPhrase(sidespin: Sidespin): string {
  if (sidespin > 0) return ' with right spin';
  if (sidespin < 0) return ' with left spin';
  return '';
}

function entryPhrase(entryDeg: number | null, margin: number): string {
  if (entryDeg === null) return '';
  if (entryDeg <= 35) return ' — coming into the line of the shot';
  if (margin >= 4) return ' — a wide window, the angle of entry hardly matters';
  if (entryDeg <= 60) return ' — entering the zone at an angle';
  return ' — crossing the line, small margin but the best available';
}

export function explainShot(
  shot: PlannedShot,
  next: PlannedShot | null,
  first: boolean,
  skill: SkillProfile,
): string {
  const intro = first
    ? `Ball in hand: place the cue ball for a ${Math.round(shot.cutDeg)}° cut on the ${shot.ball.num}, into the ${shot.pocket.label}.`
    : `${shot.ball.num} ball into the ${shot.pocket.label} (${Math.round(shot.cutDeg)}° cut).`;
  if (!next) {
    // Final ball: a Route chosen for safety (no next window to play for), so the
    // cue ball is left clear of a scratch rather than positioned.
    const safe = shot.type
      ? ` ${typePhrase(shot.type)}${spinPhrase(shot.sidespin)}${railsPhrase(shot.rails)} — a soft pot that keeps the cue ball off a scratch.`
      : '';
    return `${intro} Pot ${pct(shot.potProb)} — finish the rack.${safe}`;
  }
  if (!shot.type) {
    // Narrows shot.type to non-null for the route phrasing below. Only the
    // final ball can carry a null type, and that is handled by !next above, so
    // this is effectively unreachable — but the guard keeps the types honest.
    return `${intro} Pot ${pct(shot.potProb)} — finish the rack.`;
  }
  let route: string;
  if (shot.type === 'stop') {
    route = `Stop shot — the cue ball stays put for the ${next.ball.num}.`;
  } else {
    let zone = '';
    if (shot.zoneLen !== null) {
      const margin =
        shot.zoneLen /
        distanceSigma(shot.type, shot.travel, shot.rails, skill, dist(shot.cuePos, shot.ghost));
      const size =
        shot.zoneLen > 40
          ? `a wide-open zone (${Math.round(shot.zoneLen)}″ of the path lies inside it`
          : `the zone (${Math.round(shot.zoneLen)}″ of the path lies inside it`;
      zone = ` — ${size}${entryPhrase(shot.entryDeg, margin)})`;
    }
    route = `${typePhrase(shot.type)}${spinPhrase(shot.sidespin)}${railsPhrase(shot.rails)} sends the cue ball into position for the ${next.ball.num}${zone}.`;
  }
  return `${intro} ${route} Pot ${pct(shot.potProb)}, position ${pct(shot.eNext ?? 0)}.`;
}
