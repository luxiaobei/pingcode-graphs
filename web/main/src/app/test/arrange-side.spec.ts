import { describe, expect, it } from 'vitest';
import type { DependencyGraph } from '../entities/graph.entity';
import {
  arrangeGraph,
  mergeLayoutPositions,
  preferredSideByNode,
  resolvePinnedExpandCollapse,
  retainPositionsForPreferredSide,
  sideFromDelta,
  sideFromParent,
  sideOfType,
} from '../utils/arrange-graph';

describe('sideOfType', () => {
  it('默认：父上子下，产品需求左，测试右', () => {
    expect(sideOfType('parent')).toBe('top');
    expect(sideOfType('child')).toBe('bottom');
    expect(sideOfType('relate:idea')).toBe('left');
    expect(sideOfType('relate:ticket')).toBe('left');
    expect(sideOfType('relate:test_case')).toBe('right');
  });

  it('preferred 覆盖默认方位', () => {
    const preferred = new Map([
      ['parent', 'left' as const],
      ['child', 'right' as const],
      ['relate:idea', 'right' as const],
    ]);
    expect(sideOfType('parent', preferred)).toBe('left');
    expect(sideOfType('child', preferred)).toBe('right');
    expect(sideOfType('relate:idea', preferred)).toBe('right');
    expect(sideOfType('relate:ticket', preferred)).toBe('left');
  });
});

describe('sideFromDelta / sideFromParent', () => {
  it('sideFromDelta 按主轴判定', () => {
    expect(sideFromDelta(100, 10)).toBe('right');
    expect(sideFromDelta(-100, 10)).toBe('left');
    expect(sideFromDelta(10, 100)).toBe('bottom');
    expect(sideFromDelta(10, -100)).toBe('top');
  });

  it('sideFromParent 按相对锚点外侧判定', () => {
    const parent = { x: 0, y: 0 };
    expect(sideFromParent(parent, { x: 300, y: 0 }, { w: 40, h: 20 })).toBe('right');
    expect(sideFromParent(parent, { x: -300, y: 0 }, { w: 40, h: 20 })).toBe('left');
    expect(sideFromParent(parent, { x: 0, y: 300 }, { w: 40, h: 20 })).toBe('bottom');
    expect(sideFromParent(parent, { x: 0, y: -300 }, { w: 40, h: 20 })).toBe('top');
  });
});

describe('arrangeGraph + preferredSides', () => {
  const graph: DependencyGraph = {
    rootId: 'root',
    depth: 2,
    nodes: [
      { id: 'root', title: 'root', depth: 0 },
      { id: 'p1', title: 'parent', depth: 1, revealedByAnchorId: 'root' },
      { id: 'c1', title: 'child', depth: 1, revealedByAnchorId: 'root' },
    ],
    edges: [
      { id: 'e-p', source: 'root', target: 'p1', relationType: 'parent', label: '父' },
      { id: 'e-c', source: 'root', target: 'c1', relationType: 'child', label: '子' },
    ],
  };

  it('默认父在上、子在下', () => {
    const layout = arrangeGraph(graph);
    expect(layout.get('p1')?.side).toBe('top');
    expect(layout.get('c1')?.side).toBe('bottom');
    expect((layout.get('p1')?.y ?? 0) < (layout.get('root')?.y ?? 0)).toBe(true);
    expect((layout.get('c1')?.y ?? 0) > (layout.get('root')?.y ?? 0)).toBe(true);
  });

  it('preferred 把父排到左侧、子排到右侧', () => {
    const preferred = new Map([
      ['parent', 'left' as const],
      ['child', 'right' as const],
    ]);
    const layout = arrangeGraph(graph, preferred);
    expect(layout.get('p1')?.side).toBe('left');
    expect(layout.get('c1')?.side).toBe('right');
    expect((layout.get('p1')?.x ?? 0) < (layout.get('root')?.x ?? 0)).toBe(true);
    expect((layout.get('c1')?.x ?? 0) > (layout.get('root')?.x ?? 0)).toBe(true);
  });
});

describe('resolvePinnedExpandCollapse', () => {
  it('无明确方位偏好时有 pin 则用 pin 坐标', () => {
    const graph: DependencyGraph = {
      rootId: 'root',
      depth: 1,
      nodes: [
        { id: 'root', depth: 0 },
        { id: 'c1', depth: 1, revealedByAnchorId: 'root' },
      ],
      edges: [{ id: 'e', source: 'root', target: 'c1', relationType: 'child', label: '子' }],
    };
    const arranged = arrangeGraph(graph);
    const pins = new Map([
      ['root', { x: 500, y: 400 }],
      ['c1', { x: 700, y: 400, side: 'right' as const }],
    ]);
    const layout = resolvePinnedExpandCollapse(graph, arranged, pins);
    expect(layout.get('c1')).toMatchObject({ x: 700, y: 400, side: 'right' });
  });

  it('明确方位与 pin 不同：按 arrange 新侧初始展示', () => {
    const graph: DependencyGraph = {
      rootId: 'root',
      depth: 1,
      nodes: [
        { id: 'root', depth: 0 },
        { id: 'm1', depth: 1, revealedByAnchorId: 'root' },
      ],
      edges: [{ id: 'e', source: 'root', target: 'm1', relationType: 'mention', label: '提及' }],
    };
    const sides = new Map([['bundle', 'right' as const]]);
    const arranged = arrangeGraph(graph, sides);
    const preferred = preferredSideByNode(graph, sides);
    expect(preferred.get('m1')).toBe('right');
    const pins = new Map([
      ['root', { x: 0, y: 0 }],
      ['m1', { x: 0, y: -180, side: 'top' as const }],
    ]);
    const layout = resolvePinnedExpandCollapse(graph, arranged, pins, preferred);
    expect(layout.get('m1')?.side).toBe('right');
    expect(layout.get('m1')?.x).toBe(arranged.get('m1')?.x);
    expect(layout.get('m1')?.y).toBe(arranged.get('m1')?.y);
  });
});

describe('mergeLayoutPositions', () => {
  it('skipIds 保护换侧重锚结果', () => {
    const arranged = new Map([['a', { x: -100, y: 0, side: 'left' as const }]]);
    const saved = new Map([['a', { x: 0, y: -100, side: 'top' as const }]]);
    expect(mergeLayoutPositions(arranged, saved, new Set(['a'])).get('a')).toEqual({
      x: -100,
      y: 0,
      side: 'left',
    });
    expect(mergeLayoutPositions(arranged, saved).get('a')).toEqual({
      x: 0,
      y: -100,
      side: 'top',
    });
  });

  it('retainPositionsForPreferredSide：方位不同丢掉，相同保留', () => {
    const preferred = new Map([['a', 'right' as const]]);
    const saved = new Map([
      ['a', { x: 0, y: -100, side: 'top' as const }],
      ['b', { x: 1, y: 2, side: 'right' as const }],
    ]);
    const kept = retainPositionsForPreferredSide(saved, preferred);
    expect(kept.has('a')).toBe(false);
    expect(kept.get('b')).toEqual({ x: 1, y: 2, side: 'right' });
  });
});
