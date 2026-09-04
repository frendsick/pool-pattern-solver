import { expect, it, vi } from 'vitest';
import { vec } from '../src/geometry';
import { routeCandidates } from '../src/route';
import * as shots from '../src/shots';
import { INTERMEDIATE } from '../src/skill';
import { pocketById } from '../src/table';
import { zoneContext } from '../src/zone';

it.each([false, true])('reuses path traces across targets (lenient: %s)', (lenient) => {
  const g = shots.shotGeometry(vec(20, 15), vec(35, 25), pocketById('TR'))!;
  const next = vec(65, 25);
  const pocket = pocketById('BR');
  const zc = zoneContext(next, pocket, []);
  const target = { pocket, zc, zcPot: zc };
  const trace = vi.spyOn(shots, 'tracePath');
  try {
    const single = routeCandidates(g, [next], [target], INTERMEDIATE, lenient);
    const singleTraces = trace.mock.calls.length;
    trace.mockClear();
    // Equivalent targets isolate shared geometry from the cross-pocket bar.
    const repeated = routeCandidates(g, [next], [target, { ...target }], INTERMEDIATE, lenient);
    expect(single.length).toBeGreaterThan(0);
    expect(repeated).toEqual([...single, ...single]);
    // Only final candidate validation needs more traces for the second target.
    expect(trace.mock.calls.length).toBeLessThan(singleTraces * 1.25);
  } finally {
    trace.mockRestore();
  }
});
