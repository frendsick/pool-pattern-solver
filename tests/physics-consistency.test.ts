import { describe, expect, it, vi } from 'vitest';
import { add, angleBetween, dist, norm, rotate, scale, sub, vec } from '../src/geometry';
import { MIN_Y, pocketById } from '../src/table';
import * as shots from '../src/shots';
import * as routes from '../src/route';
import { finalSafetyRoute, expectedNextPot, pocketRisk } from '../src/route';
import { solve } from '../src/solver';
import { INTERMEDIATE, potProbability, routeEase, walkExit } from '../src/skill';
import { zoneContext, zoneValue } from '../src/zone';

const ball = vec(50, 25);
const pocket = pocketById('TS');
const ghost = vec(50, 22.75);
const geometry = (cut: number) => shots.shotGeometry(
  add(ghost, scale(rotate(vec(0, -1), cut * Math.PI / 180), 20)), ball, pocket,
)!;

describe('physical shot constraints', () => {
  it('rejects contact through a solid cushion', () => {
    const cue = vec(10, 1.5), object = vec(30, 1.5), corner = pocketById('TR');
    expect(shots.shotGeometry(cue, object, corner)).toBeNull();
    expect(zoneValue(cue, zoneContext(object, corner, []), INTERMEDIATE)).toBe(0);
  });

  it('scratches at a pocket opening, not on the cloth beside it', () => {
    const path = [vec(45, 2.5), vec(55, 2.5)];
    expect(shots.tracePath(path[0], vec(1, 0), 10, []).outcome).toBe('ok');
    expect(pocketRisk(path)).toBe(1);
    expect(shots.tracePath(vec(50, 10), vec(0, -1), 7.5, []).outcome).toBe('ok');
    const scratch = shots.tracePath(vec(50, 10), vec(0, -1), 10, []);
    expect(scratch.outcome).toBe('scratch');
    expect(scratch.end.y).toBeCloseTo(MIN_Y);
  });

  it('only freezes the cue ball on a straight stop shot', () => {
    const g = geometry(8);
    expect(finalSafetyRoute(add(g.ghost, scale(g.cueDir, -20)), ball, INTERMEDIATE)!.type)
      .not.toBe('stop');
    expect(finalSafetyRoute(vec(50, 8), ball, INTERMEDIATE)!.type).toBe('stop');
    expect(shots.departureDir(geometry(0.5), 'stun')).not.toBeNull();
  });

  it('does not share cached stop control with a small cut', () => {
    const nextValue = (p: { x: number; y: number }) => dist(p, ghost) < 0.01 ? 1 : 0;
    const context = () => zoneContext(ball, pocket, [], [], nextValue);
    const zc = context();
    const cue = (cut: number) => add(ghost, scale(geometry(cut).cueDir, -20));
    const straight = zoneValue(cue(0), zc, INTERMEDIATE);
    const smallCut = zoneValue(cue(0.1), zc, INTERMEDIATE);
    expect(smallCut).toBe(zoneValue(cue(0.1), context(), INTERMEDIATE));
    expect(smallCut).toBeLessThan(straight);
  });

  it('applies sidespin at a cushion reached during the slide', () => {
    const object = vec(3, 25), corner = pocketById('TL');
    const aim = norm(sub(corner.target, object));
    const contact = sub(object, scale(aim, 2.25));
    const cue = add(contact, scale(rotate(aim, Math.PI / 6), -20));
    const g = shots.shotGeometry(cue, object, corner)!;
    const dir = shots.departureDir(g, 'follow')!;
    const curve = shots.caromCurve(g, 'follow', 100)!;
    const left = shots.tracePath(contact, dir, 100, [], { curve, sidespin: -0.5 });
    const right = shots.tracePath(contact, dir, 100, [], { curve, sidespin: 0.5 });
    const rail = left.points.findIndex(p => Math.abs(p.x - 1.125) < 1e-6);
    expect(rail).toBeGreaterThan(0);
    expect(dist(left.points[rail + 1], right.points[rail + 1])).toBeGreaterThan(0.01);
  });

  it('loses sidespin across successive cushion contacts', () => {
    const tr = shots.tracePath(vec(25, 25), vec(1, 0), 220, [], { sidespin: 0.5 });
    expect(tr.outcome).toBe('ok');
    expect(tr.rails).toBe(2);
    const turns = [1, 2].map(i => {
      const incoming = norm(sub(tr.points[i], tr.points[i - 1]));
      const outgoing = sub(tr.points[i + 1], tr.points[i]);
      return angleBetween(vec(-incoming.x, incoming.y), outgoing);
    });
    expect(turns[1]).toBeGreaterThan(0);
    expect(turns[1]).toBeLessThan(0.75 * turns[0]);
  });

  it('scales the slide curve for every distance-error sample', () => {
    const g = geometry(30), curve = shots.caromCurve(g, 'draw', 40)!;
    const trace = vi.spyOn(shots, 'traceShot');
    try {
      const skill = { ...INTERMEDIATE, aimSigma: 0,
        dirSigma: { stop: 0, follow: 0, stun: 0, lowTouch: 0, draw: 0 } };
      expectedNextPot(g.ghost, shots.departureDir(g, 'draw')!, 40, 'draw', 0, [],
        zoneContext(vec(60, 25), pocket, []), skill, 0, { g, pocket }, curve);
      expect(trace.mock.calls.length).toBeGreaterThan(1);
      let checked = 0;
      for (let i = 0; i < trace.mock.calls.length; i++) {
        const result = trace.mock.results[i].value;
        if (result.outcome !== 'ok' || result.rails !== 0) continue;
        expect(result.curve.arc).toBeCloseTo(shots.caromCurve(g, 'draw', trace.mock.calls[i][2])!.arc, 6);
        checked++;
      }
      expect(checked).toBeGreaterThan(1);
    } finally { trace.mockRestore(); }
  });

  it('distinguishes a rail limit from coming to rest', () => {
    const trace = shots.tracePath(vec(25, 25), vec(0, 1), 220, [], { maxRails: 3 });
    expect(trace.travelled).toBeLessThan(220);
    expect(trace.outcome).not.toBe('ok');
    expect(shots.tracePath(vec(25, 25), vec(NaN, 1), 10, []).outcome).toBe('invalid');
  });

  it('tries another beam candidate when the first has no complete finish', () => {
    const finish = vi.spyOn(routes, 'finalSafetyRoute').mockReturnValueOnce(null);
    try {
      expect(solve({ seed: 0, balls: [{ num: 9, pos: ball }] }, INTERMEDIATE)).not.toBeNull();
      expect(finish).toHaveBeenCalledTimes(2);
    } finally { finish.mockRestore(); }
  });

  it('uses the same slide and roll energy for pot pace and hit power', () => {
    const g = geometry(0);
    const travel = shots.minCueTravel(g, 'follow');
    // Full rolling follow keeps about 16% of the object ball's travel.
    expect(travel).toBeCloseTo(25 * shots.POCKET_PACE * 0.16, 1);
    expect(shots.hitDistance(g, 'follow', travel)).toBeCloseTo(
      shots.hitDistance(g, 'stop', 0), 6,
    );
  });

  it('narrows the pocket margin when the object ball arrives faster', () => {
    const g = geometry(30);
    expect(potProbability(g, pocket, INTERMEDIATE, 200))
      .toBeLessThan(potProbability(g, pocket, INTERMEDIATE, 25 * shots.POCKET_PACE));
  });

  it('charges the energy lost at the actual rail contact', () => {
    const first = vec(25, 25), rail = vec(25, MIN_Y), end = vec(25, 20);
    const path = [first, rail, end];
    const expected = dist(first, rail) + dist(rail, end) / shots.CUSHION_RESTITUTION ** 2;
    expect(shots.pathPowerTravel(path, vec(0, -1))).toBeCloseTo(expected, 6);
    const g = geometry(30), travel = dist(first, rail) + dist(rail, end);
    expect(routeEase(g, 'follow', 0, travel, 1, dist(first, rail), INTERMEDIATE, expected))
      .toBeLessThan(routeEase(g, 'follow', 0, travel, 1, dist(first, rail), INTERMEDIATE, travel));
  });

  it('resolves a curved rail route with a slide scaled to the required energy', () => {
    const g = geometry(30);
    const route = shots.traceShot(g, 'follow', 80, []);
    expect(route.outcome).toBe('ok');
    expect(route.rails).toBeGreaterThan(0);
    expect(route.powerTravel).toBeGreaterThan(route.travelled);
    expect(route.curve!.arc).toBeCloseTo(shots.caromCurve(g, 'follow', route.powerTravel)!.arc, 2);
  });

  it('charges an immediate rebound when starting against a cushion', () => {
    const dir = vec(0, -1);
    const tr = shots.tracePath(vec(25, MIN_Y), dir, 10, []);
    const power = 10 / shots.CUSHION_RESTITUTION ** 2;
    expect(tr.rails).toBe(1);
    expect(shots.pathPowerTravel(tr.points, dir)).toBeCloseTo(power, 6);
    const g = geometry(0);
    const [step] = walkExit(tr.points, 1, 0, g, 'follow', 0, INTERMEDIATE, 10, false);
    expect(step.ease).toBeCloseTo(routeEase(g, 'follow', 0, 10, 1, 0, INTERMEDIATE, power), 6);
  });

  it('uses the same straight approximation for the near-straight locus and trace', () => {
    const g = geometry(1.7);
    for (const type of ['follow', 'lowTouch', 'draw'] as const) {
      const locus = shots.caromLocus(g, type)!;
      const tr = shots.traceShot(g, type, 15, []);
      expect(tr.outcome).toBe('ok');
      expect(tr.rails).toBe(0);
      expect(dist(tr.end, add(g.ghost, scale(locus.dir, 15 * locus.eta)))).toBeLessThan(1e-9);
    }
  });
});
