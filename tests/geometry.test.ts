import { describe, expect, it } from 'vitest';
import { isValidQuadrilateral, orderCorners, polygonArea } from '../src/lib/geometry';

describe('geometría del documento', () => {
  it('ordena las esquinas aunque lleguen mezcladas', () => {
    const result = orderCorners([{ x: 90, y: 10 }, { x: 10, y: 90 }, { x: 10, y: 10 }, { x: 90, y: 90 }]);
    expect(result).toEqual([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }]);
  });

  it('calcula el área de una hoja rectangular', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }])).toBe(20000);
  });

  it('rechaza geometría demasiado pequeña o desproporcionada', () => {
    expect(isValidQuadrilateral([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }], 100, 100)).toBe(true);
    expect(isValidQuadrilateral([{ x: 48, y: 48 }, { x: 52, y: 48 }, { x: 52, y: 52 }, { x: 48, y: 52 }], 100, 100)).toBe(false);
  });
});
