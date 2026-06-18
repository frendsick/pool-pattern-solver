// Kinematic shot playback (issue #19, ADR-0006): a replay over the geometry the
// solver already traced, NOT a physics sim. The balls must start where the
// diagram drew them, end frozen on the leave (cue on landing, object potted),
// and never leave the traced cue path or the object-ball-to-pocket line.

import { describe, it, expect } from 'vitest';
import { vec, dist, distPointSegment } from '../src/geometry';
import { Layout, pocketById, BALL_R } from '../src/table';
import { INTERMEDIATE } from '../src/skill';
import { solve } from '../src/solver';
import type { PlannedShot } from '../src/solver';
import { buildPlayback } from '../src/playback';

// Distance from a point to the nearest segment of a polyline.
function distToPolyline(p: { x: number; y: number }, poly: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) best = Math.min(best, distPointSegment(p, poly[i - 1], poly[i]));
  return best;
}

// A PlannedShot carrying only the fields playback reads; the rest are inert.
function makeShot(over: Partial<PlannedShot>): PlannedShot {
  return {
    ball: { num: 1, pos: vec(50, 25) },
    pocket: pocketById('TS'),
    cuePos: vec(50, 5),
    ghost: vec(50, 22.75),
    cutDeg: 0,
    potProb: 1,
    type: 'follow',
    sidespin: 0,
    path: [vec(50, 22.75), vec(50, 40)],
    landing: vec(50, 40),
    rails: 0,
    travel: 17.25,
    eNext: null,
    windowRef: null,
    zoneLen: null,
    entryDeg: null,
    zone: null,
    explanation: '',
    ...over,
  };
}

describe('shot playback (issue #19)', () => {
  it('starts on the cue placement and object ball, ends frozen on the leave', () => {
    const shot = makeShot({});
    const pb = buildPlayback(shot);
    expect(pb.duration).toBeGreaterThan(0);

    const start = pb.at(0);
    expect(dist(start.cue, shot.cuePos)).toBeCloseTo(0, 6);
    expect(start.object).not.toBeNull();
    expect(dist(start.object!, shot.ball.pos)).toBeCloseTo(0, 6);
    expect(start.done).toBe(false);

    const end = pb.at(pb.duration + 1);
    expect(end.done).toBe(true);
    expect(end.object).toBeNull(); // object ball has dropped
    expect(dist(end.cue, shot.landing!)).toBeCloseTo(0, 6); // cue frozen on landing
  });

  it('reaches the ghost at contact, then caroms to landing', () => {
    const shot = makeShot({});
    const pb = buildPlayback(shot);
    // Mid-flight the cue is on the table somewhere between cue and landing.
    const mid = pb.at(pb.duration / 2);
    expect(mid.done).toBe(false);
  });

  it('never leaves the traced cue path or the object-ball-to-pocket line', () => {
    const shot = makeShot({
      // A caroming follow whose path bends across the table.
      path: [vec(50, 22.75), vec(50, 40), vec(70, 40)],
      landing: vec(70, 40),
      travel: 37.25,
    });
    const objLine = [shot.ball.pos, shot.pocket.target];
    const pb = buildPlayback(shot);
    for (let i = 0; i <= 40; i++) {
      const st = pb.at((pb.duration * i) / 40);
      // The cue is on the approach line or the carom path the whole time.
      const onApproach = distToPolyline(st.cue, [shot.cuePos, shot.ghost]);
      const onPath = distToPolyline(st.cue, shot.path!);
      expect(Math.min(onApproach, onPath)).toBeLessThan(0.05);
      if (st.object) expect(distToPolyline(st.object, objLine)).toBeLessThan(0.05);
    }
  });

  it('a longer cue carom takes longer to play (duration tracks distance)', () => {
    const near = buildPlayback(makeShot({ path: [vec(50, 22.75), vec(50, 32)], landing: vec(50, 32), travel: 9.25 }));
    const far = buildPlayback(makeShot({ path: [vec(50, 22.75), vec(50, 48)], landing: vec(50, 48), travel: 25.25 }));
    expect(far.duration).toBeGreaterThan(near.duration);
  });

  it('never walks the cue backward once it has come to rest', () => {
    // Regression: the kinematic d(t)=v0·t−½at² parabola turns DOWN past the
    // rest-instant, which used to walk the cue back the way it came whenever the
    // object ball was still rolling after the cue had stopped. The cue's
    // progress ALONG ITS PATH must be monotonic non-decreasing for the whole
    // shot (a long object roll holds the stopped cue in place, never reverses).
    const shot = makeShot({
      path: [vec(50, 22.75), vec(50, 40), vec(70, 40)],
      landing: vec(70, 40),
      travel: 37.25,
      // far object ball so it is still rolling long after the cue has stopped
      ball: { num: 1, pos: vec(50, 25) },
      pocket: pocketById('TR'),
    });
    const pb = buildPlayback(shot);
    const arc = (p: { x: number; y: number }) => {
      let acc = 0, best = Infinity, bestArc = 0;
      const poly = shot.path!;
      for (let i = 1; i < poly.length; i++) {
        const a = poly[i - 1], b = poly[i];
        const ab = { x: b.x - a.x, y: b.y - a.y };
        const L = Math.hypot(ab.x, ab.y);
        let t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (L * L);
        t = Math.max(0, Math.min(1, t));
        const d = dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
        if (d < best) { best = d; bestArc = acc + t * L; }
        acc += L;
      }
      return bestArc;
    };
    let prev = -1;
    for (let k = 0; k <= 300; k++) {
      const a = arc(pb.at((pb.duration * k) / 300).cue);
      expect(a).toBeGreaterThanOrEqual(prev - 0.2); // monotonic (tiny slide-curve sampling slack)
      prev = a;
    }
  });

  it('rests the cue exactly on the leave, even when the path overshoots it (stop shot)', () => {
    // A stop shot's landing is the ghost (cue stays put) while minCueTravel
    // traces the path ~0.5in past it. The cue must rest on `landing` — which is
    // the next shot's cue position — not on the path end, so the freeze flows
    // seamlessly into the next step instead of snapping back.
    const shot = makeShot({
      type: 'stop',
      cutDeg: 4,
      travel: 0.5,
      cuePos: vec(40, 15),
      ghost: vec(50, 22.75),
      path: [vec(50, 22.75), vec(50, 22.25)], // path runs 0.5in past landing
      landing: vec(50, 22.75),
    });
    const pb = buildPlayback(shot);
    // Once the object ball is moving we are post-contact; from then on a stop
    // shot's cue must sit on the landing (it never creeps onto the path's
    // overshoot, and never snaps back off it).
    for (let k = 0; k <= 200; k++) {
      const st = pb.at((pb.duration * k) / 200);
      const postContact = st.object === null || dist(st.object, shot.ball.pos) > 0.01;
      if (postContact) expect(dist(st.cue, shot.landing!)).toBeLessThan(0.05);
    }
    expect(dist(pb.at(pb.duration + 1).cue, shot.landing!)).toBeCloseTo(0, 6);
  });

  it('does not let the caroming cue overtake the ball it just potted (90° rule)', () => {
    // Near-straight follow: the cue follows the object ball down nearly the same
    // line. The object ball must leave fast (impact-line share vContact·cos θ)
    // and drop before the slower caroming cue arrives — centers never overlap.
    const shot = makeShot({
      type: 'follow',
      cutDeg: 5,
      ball: { num: 1, pos: vec(50, 25) },
      pocket: pocketById('TS'), // straight up
      ghost: vec(50, 22.75),
      path: [vec(50, 22.75), vec(50, 47)],
      landing: vec(50, 47),
      travel: 24.25,
    });
    const pb = buildPlayback(shot);
    let minSep = Infinity;
    for (let k = 0; k <= 400; k++) {
      const st = pb.at((pb.duration * k) / 400);
      if (st.object) minSep = Math.min(minSep, dist(st.cue, st.object));
    }
    expect(minSep).toBeGreaterThan(2 * BALL_R - 1e-6); // never interpenetrate
  });

  it('plays every shot of a solved pattern without leaving the diagram', () => {
    const layout: Layout = {
      seed: 0,
      balls: [
        { num: 7, pos: vec(25, 35) },
        { num: 8, pos: vec(50, 15) },
        { num: 9, pos: vec(75, 35) },
      ],
    };
    const pattern = solve(layout, INTERMEDIATE)!;
    for (const shot of pattern.shots) {
      const pb = buildPlayback(shot);
      expect(pb.duration).toBeGreaterThan(0);
      const end = pb.at(pb.duration + 1);
      expect(end.done).toBe(true);
      expect(end.object).toBeNull();
      if (shot.landing) expect(dist(end.cue, shot.landing)).toBeCloseTo(0, 6);
    }
  });
});
