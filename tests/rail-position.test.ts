import { describe, it, expect } from 'vitest';
import { vec } from '../src/geometry';
import { pocketById } from '../src/table';
import { zoneContext } from '../src/zone';
import { INTERMEDIATE } from '../src/skill';
import { expectedNextPot } from '../src/solver';

// Pros use the rail behind a position window to GUARANTEE the shot: without
// the wall the cue ball is only in the window at the very end of its travel
// (come up short and there is no shot), while a route driven into the cushion
// folds the landing spread back along the shooting line — wherever the ball
// stops, even accidentally straight, there is a shot.
describe('rail-assisted position', () => {
  // Next ball mid-table, potted to the top side: its window runs straight
  // down from the ball into the bottom cushion.
  const ball = vec(50, 25);
  const ts = pocketById('TS');
  const zc = zoneContext(ball, ts, []);
  const obstacles = [ball];

  // A route running down that corridor, 5.5" beside the ball's line.
  const start = vec(55.5, 45);
  const down = vec(0, -1);

  it('driving into the cushion behind the window beats stopping dead in it', () => {
    // Direct: intended landing (55.5, 15), the window only at the end of travel —
    // coming up short strands the cue ball on top of the next ball, no shot.
    const direct = expectedNextPot(start, down, 30, 'follow', 0, obstacles, zc, INTERMEDIATE);
    // Rail: drive into the cushion and land just off it on the way back —
    // short stays on the inbound corridor, long rolls back up it: a shot
    // wherever the cue ball stops, even accidentally straight.
    const railTravel = 45 - 1.125 + (8 - 1.125);
    const rail = expectedNextPot(start, down, railTravel, 'follow', 1, obstacles, zc, INTERMEDIATE);
    expect(rail).toBeGreaterThan(direct);
    expect(rail).toBeGreaterThan(0.5);
  });
});
