import { expect, it } from 'vitest';
import { renderScene, svgToTablePoint, tableToSvgPoint } from '../src/render';
import { TABLE_W } from '../src/table';

it('draws six cushions with 4.5-inch corner mouths and 5-inch side mouths', () => {
  const svg = renderScene({
    balls: [], cue: null, shot: null,
    originZone: [], zone: [], altZones: [], ghostPaths: [],
  });
  const cushions = [...svg.matchAll(/<polygon points="([^"]+)"/g)].map(match =>
    match[1].split(' ').map(point => point.split(',').map(Number)),
  );
  expect(cushions).toHaveLength(6);
  const [cornerX, cornerY] = cushions[0][0];
  const [shortX, shortY] = cushions[4][0];
  expect(Math.hypot(cornerX - shortX, cornerY - shortY)).toBeCloseTo(4.5);
  expect(TABLE_W - 2 * cushions[0][1][0]).toBeCloseTo(5);

  // The wider rail must not shift ball placement relative to the cloth.
  const origin = tableToSvgPoint({ x: 0, y: 0 });
  expect(origin).toEqual({ x: 63, y: 513 });
  expect(svgToTablePoint(origin)).toEqual({ x: 0, y: 0 });
});
