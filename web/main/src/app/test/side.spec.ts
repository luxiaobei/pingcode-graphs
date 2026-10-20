import { describe, expect, it } from 'vitest';
import { assignRelationSides, isSide, normalizeRelationSides } from '../utils/side';

describe('isSide', () => {
  it('仅接受上下左右', () => {
    expect(isSide('left')).toBe(true);
    expect(isSide('right')).toBe(true);
    expect(isSide('top')).toBe(true);
    expect(isSide('bottom')).toBe(true);
    expect(isSide('middle')).toBe(false);
    expect(isSide(1)).toBe(false);
    expect(isSide(null)).toBe(false);
  });
});

describe('normalizeRelationSides', () => {
  it('过滤非法方位并保留合法项', () => {
    expect(
      normalizeRelationSides({
        parent: 'left',
        child: 'nope',
        'relate:idea': 'right',
        '': 'top',
      }),
    ).toEqual({ parent: 'left', 'relate:idea': 'right' });
  });

  it('空或无效输入返回 undefined', () => {
    expect(normalizeRelationSides(null)).toBeUndefined();
    expect(normalizeRelationSides([])).toBeUndefined();
    expect(normalizeRelationSides({ child: 'north' })).toBeUndefined();
  });
});

describe('assignRelationSides', () => {
  it('先清空再写入 Map / Record', () => {
    const target = new Map([['old', 'top' as const]]);
    assignRelationSides(target, { parent: 'left', child: 'bottom' });
    expect(Object.fromEntries(target)).toEqual({ parent: 'left', child: 'bottom' });

    assignRelationSides(target, new Map([['parent', 'right']]));
    expect(Object.fromEntries(target)).toEqual({ parent: 'right' });

    assignRelationSides(target, null);
    expect(target.size).toBe(0);
  });
});
