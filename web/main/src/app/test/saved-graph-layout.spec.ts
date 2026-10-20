import { describe, expect, it } from 'vitest';
import type { DependencyGraph } from '../entities/graph.entity';
import {
  applySavedGraphLayout,
  cardPositionsFromNodes,
  normalizeSavedGraphLayout,
} from '../utils/saved-graph-layout';

describe('cardPositionsFromNodes', () => {
  it('收集含 fold 的有效坐标，跳过 relationHub', () => {
    const map = cardPositionsFromNodes([
      { id: 'a', position: { x: 1, y: 2, side: 'left' } },
      { id: 'hub', relationHub: 'child', position: { x: 9, y: 9 } },
      {
        id: 'fold:a::child',
        foldSummary: { key: 'a::child', relationType: 'child', count: 2, expanded: false },
        position: { x: 3, y: 4, side: 'right' },
      },
      { id: 'bad', position: { x: Number.NaN, y: 0 } },
    ]);
    expect([...map.keys()].sort()).toEqual(['a', 'fold:a::child']);
    expect(map.get('a')).toEqual({ x: 1, y: 2, side: 'left' });
    expect(map.get('fold:a::child')).toEqual({ x: 3, y: 4, side: 'right' });
  });
});

describe('applySavedGraphLayout', () => {
  it('把 saved 坐标写回可见节点（含 fold）', () => {
    const graph: DependencyGraph = {
      rootId: 'root',
      depth: 1,
      nodes: [
        { id: 'root' },
        {
          id: 'fold:root::parent',
          foldSummary: { key: 'root::parent', relationType: 'parent', count: 1, expanded: false },
        },
        { id: 'hub', relationHub: 'parent' },
      ],
      edges: [],
    };
    const next = applySavedGraphLayout(graph, {
      rootId: 'root',
      positions: {
        root: { x: 10, y: 20 },
        'fold:root::parent': { x: -100, y: 20, side: 'left' },
        hub: { x: 1, y: 1 },
      },
      collapsedKeys: [],
    });
    expect(next.nodes.find((n) => n.id === 'root')?.position).toEqual({ x: 10, y: 20 });
    expect(next.nodes.find((n) => n.id === 'fold:root::parent')?.position).toEqual({
      x: -100,
      y: 20,
      side: 'left',
    });
    expect(next.nodes.find((n) => n.id === 'hub')?.position).toBeUndefined();
  });
});

describe('normalizeSavedGraphLayout', () => {
  it('解析 positions / relationSides / collapsedKeys', () => {
    const layout = normalizeSavedGraphLayout(
      {
        rootId: 'root',
        positions: {
          root: { x: 1, y: 2 },
          a: { x: 3, y: 4, side: 'left' },
          bad: { x: 'x', y: 0 },
        },
        collapsedKeys: ['root::child', 1],
        relationSides: { parent: 'left', child: 'nope' },
      },
      'root',
    );
    expect(layout).toEqual({
      rootId: 'root',
      positions: {
        root: { x: 1, y: 2 },
        a: { x: 3, y: 4, side: 'left' },
      },
      collapsedKeys: ['root::child'],
      relationSides: { parent: 'left' },
    });
  });

  it('rootId 不一致时仍带回用户级 relationSides，不套坐标', () => {
    const layout = normalizeSavedGraphLayout(
      {
        rootId: 'other',
        positions: { a: { x: 1, y: 2 } },
        collapsedKeys: ['k'],
        relationSides: { child: 'right' },
      },
      'root',
    );
    expect(layout).toEqual({
      rootId: 'root',
      positions: {},
      collapsedKeys: [],
      relationSides: { child: 'right' },
    });
  });

  it('全空返回 null', () => {
    expect(normalizeSavedGraphLayout({}, 'root')).toBeNull();
    expect(normalizeSavedGraphLayout(null, 'root')).toBeNull();
  });
});
