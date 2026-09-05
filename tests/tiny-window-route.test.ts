import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry';
import { Layout, pocketById } from '../src/table';
import { INTERMEDIATE, type SkillProfile } from '../src/skill';
import { solve } from '../src/solver';
import { routeCandidates, zoneTargets } from '../src/route';
import { shotGeometry } from '../src/shots';
import { surfacesForLayout, zoneInputsForBall } from '../src/value';

// Feedback seed 393049847, n=7: the generated layout accepted a 5 -> bottom
// side plan that sent the cue ball 88" around two rails into a tiny 6-ball
// lobe and reported it as a 73% position route. The problem is not that the
// line is impossible; it is that a long centerline through a narrow lobe needs
// lateral control, so path length inside the lobe must not read as a wide
// position zone.
describe('long route through a tiny position lobe', () => {
  const layout: Layout = {
    seed: 393049847,
    balls: [
      { num: 3, pos: vec(72.43, 39.12) },
      { num: 4, pos: vec(94.43, 20.97) },
      { num: 5, pos: vec(56.88, 19.39) },
      { num: 6, pos: vec(40.57, 40.76) },
      { num: 7, pos: vec(32.32, 30.15) },
      { num: 8, pos: vec(23.2, 32.36) },
      { num: 9, pos: vec(76.29, 6.23) },
    ],
  };

  it('no longer rates the two-rail 5-to-6 lobe as a high-confidence leave', () => {
    const pattern = solve(layout, INTERMEDIATE);
    expect(pattern).not.toBeNull();

    const shot = pattern!.shots[2];
    expect(shot.ball.num).toBe(5);

    if (shot.rails >= 2 && shot.landing!.x < layout.balls[3].pos.x) {
      expect(shot.eNext!).toBeLessThan(0.55);
      expect(pattern!.score).toBeLessThan(0.7 ** layout.balls.length);
    }
  });

  it('measures low-ease route width against the raw zone bar', () => {
    const lowFollowSkill: SkillProfile = {
      ...INTERMEDIATE,
      typeReliability: { ...INTERMEDIATE.typeReliability, follow: 0.62 },
    };
    const cue = vec(65.241, 33.412);
    const ballIndex = 2;
    const nextIndex = ballIndex + 1;
    const g = shotGeometry(cue, layout.balls[ballIndex].pos, pocketById('BS'));
    expect(g).not.toBeNull();

    const surfaces = surfacesForLayout(layout, lowFollowSkill);
    const targets = zoneTargets(layout.balls, nextIndex, surfaces, lowFollowSkill);
    const { obstacles: laterPos } = zoneInputsForBall(layout.balls, nextIndex, surfaces);
    const obstacles = [layout.balls[nextIndex].pos, ...laterPos];
    const candidates = routeCandidates(g!, obstacles, targets, lowFollowSkill, true);
    const route = candidates.find(
      (c) =>
        c.type === 'follow' &&
        c.nextPocket.id === 'TR' &&
        c.rails === 2 &&
        c.sidespin === 0,
    );

    expect(route).toBeDefined();
    expect(route!.ease).toBeCloseTo(0.62, 5);
    expect(route!.windowFactor).toBeLessThan(0.5);
  });
});
