// Probe round-7 feedback: from the user's preferred bottom-rail cue position
// (angle on the 8, shot along the rail), how does each route to the 9's zone
// score vs the solver's mid-table touch-of-low? Compares the transition
// factor e = expectedNextPot * reliability * power for hand-picked cue spots.

import { vec, norm, sub } from '../src/geometry';
import { pocketById } from '../src/table';
import { INTERMEDIATE, powerFactor, routeReliability } from '../src/skill';
import { shotGeometry, departureDir, minCueTravel, hitDistance, tracePath, ShotType } from '../src/shots';
import { zoneContext, zoneValue, zonePeak } from '../src/zone';
import { expectedNextPot } from '../src/solver';

const ball8 = vec(86.8, 5.5);
const ball9 = vec(74.8, 12.9);
const br = pocketById('BR');

// The 9's zones (last ball: no onward gate), one per pocket.
const ninePockets = ['BL', 'BR', 'BS', 'TS', 'TL', 'TR'] as const;

function bestE(cue: { x: number; y: number }) {
  const g = shotGeometry(cue, ball8, br);
  if (!g) return;
  console.log(`cue (${cue.x}, ${cue.y}) cut ${((g.cut * 180) / Math.PI).toFixed(1)}°`);
  for (const pid of ninePockets) {
    const zc = zoneContext(ball9, pocketById(pid), []);
    if (!zc.ballPathClear || zonePeak(zc, INTERMEDIATE) <= 0.2) continue;
    for (const type of ['follow', 'stun', 'lowTouch', 'draw'] as ShotType[]) {
      const dir = departureDir(g, type);
      if (!dir) continue;
      const minT = minCueTravel(g, type);
      let best = { e: 0, travel: 0, rails: 0 };
      for (let travel = Math.max(minT, 4); travel <= 200; travel += 4) {
        const pw = powerFactor(hitDistance(g, type, travel), INTERMEDIATE);
        if (pw <= 0) break;
        const tr = tracePath(g.ghost, norm(dir), travel, [ball9], 4);
        if (tr.outcome !== 'ok') continue;
        const e =
          expectedNextPot(g.ghost, dir, travel, type, tr.rails, [ball9], zc, INTERMEDIATE, g.dCueGhost) *
          routeReliability(type, g.dCueGhost, INTERMEDIATE) *
          pw;
        if (e > best.e) best = { e, travel, rails: tr.rails };
      }
      if (best.e > 0.5)
        console.log(
          `  9>${pid} ${type.padEnd(8)} travel ${String(best.travel).padStart(3)}″ rails ${best.rails}  e=${best.e.toFixed(2)}`,
        );
    }
  }
}

// Solver's current choice: mid-table, 15.5° cut.
bestE(vec(53.0, 9.2));
// User's pattern: cue near the bottom rail, bigger angle, shot along the rail.
bestE(vec(62, 4));
bestE(vec(58, 6));
