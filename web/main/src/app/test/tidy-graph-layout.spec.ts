import { describe, expect, it } from 'vitest';
import type { DependencyGraph } from '../entities/graph.entity';
import { GRAPH_NODE_SIZE } from '../constants/graph.constants';
import { trunkEdges } from '../utils/route-graph-edges';
import { tidyGraphLayout } from '../utils/tidy-graph-layout';

const graph: DependencyGraph = {
  rootId: 'root',
  depth: 1,
  nodes: [
    { id: 'root', title: 'root', depth: 0 },
    { id: 'p1', title: 'parent', depth: 1, revealedByAnchorId: 'root' },
    { id: 'm1', title: 'mention', depth: 1, revealedByAnchorId: 'root' },
    { id: 'm2', title: 'dup', depth: 1, revealedByAnchorId: 'root' },
    { id: 't1', title: 'ticket', depth: 1, revealedByAnchorId: 'root' },
    { id: 'c1', title: 'child', depth: 1, revealedByAnchorId: 'root' },
  ],
  edges: [
    { id: 'e-p', source: 'root', target: 'p1', relationType: 'parent', label: '父工作项' },
    { id: 'e-m', source: 'root', target: 'm1', relationType: 'mention', label: '提及' },
    { id: 'e-d', source: 'root', target: 'm2', relationType: 'duplicate', label: '重复' },
    { id: 'e-t', source: 'root', target: 't1', relationType: 'relate:ticket', label: '关联工单' },
    { id: 'e-c', source: 'root', target: 'c1', relationType: 'child', label: '子工作项' },
  ],
};

describe('tidyGraphLayout', () => {
  it('四向整图重排：根不动，各侧共线，保留当前关系方位', () => {
    const pins = new Map([
      ['root', { x: 400, y: 300 }],
      ['p1', { x: 380, y: 80, side: 'top' as const }],
      ['m1', { x: 520, y: 40, side: 'top' as const }],
      ['m2', { x: 260, y: 120, side: 'top' as const }],
      ['t1', { x: 700, y: 280, side: 'right' as const }],
      ['c1', { x: 410, y: 520, side: 'bottom' as const }],
    ]);

    const next = tidyGraphLayout(graph, pins);

    expect(next.get('root')).toEqual({ x: 400, y: 300 });
    expect(next.get('p1')?.side).toBe('top');
    expect(next.get('m1')?.side).toBe('top');
    expect(next.get('m2')?.side).toBe('top');
    expect(next.get('t1')?.side).toBe('right');
    expect(next.get('c1')?.side).toBe('bottom');

    // 上侧共线；右侧 / 下侧落在对应象限
    expect(next.get('p1')?.y).toBeCloseTo(next.get('m1')?.y ?? NaN, 0);
    expect(next.get('m1')?.y).toBeCloseTo(next.get('m2')?.y ?? NaN, 0);
    expect((next.get('t1')?.x ?? 0) > 400).toBe(true);
    expect((next.get('c1')?.y ?? 0) > 300).toBe(true);

    // 乱拖坐标被重排
    expect(next.get('m1')?.x).not.toBe(520);
    expect(next.get('m2')?.y).not.toBe(120);
  });

  it('左侧堆了很多卡时，上侧仍共线整齐（不会被左侧挤乱）', () => {
    const wide: DependencyGraph = {
      rootId: 'root',
      depth: 1,
      nodes: [
        { id: 'root', title: 'root', depth: 0 },
        { id: 'idea1', title: 'i1', depth: 1, revealedByAnchorId: 'root' },
        { id: 'idea2', title: 'i2', depth: 1, revealedByAnchorId: 'root' },
        { id: 'test1', title: 'c1', depth: 1, revealedByAnchorId: 'root' },
        { id: 'test2', title: 'c2', depth: 1, revealedByAnchorId: 'root' },
        { id: 'm1', title: 'm1', depth: 1, revealedByAnchorId: 'root' },
        { id: 'm2', title: 'm2', depth: 1, revealedByAnchorId: 'root' },
        { id: 'm3', title: 'm3', depth: 1, revealedByAnchorId: 'root' },
        { id: 'm4', title: 'm4', depth: 1, revealedByAnchorId: 'root' },
      ],
      edges: [
        { id: 'e-i1', source: 'root', target: 'idea1', relationType: 'relate:idea', label: '关联产品需求' },
        { id: 'e-i2', source: 'root', target: 'idea2', relationType: 'relate:idea', label: '关联产品需求' },
        {
          id: 'e-c1',
          source: 'root',
          target: 'test1',
          relationType: 'relate:test_case',
          label: '关联测试',
        },
        {
          id: 'e-c2',
          source: 'root',
          target: 'test2',
          relationType: 'relate:test_case',
          label: '关联测试',
        },
        { id: 'e-m1', source: 'root', target: 'm1', relationType: 'mention', label: '提及' },
        { id: 'e-m2', source: 'root', target: 'm2', relationType: 'cause', label: '原因' },
        { id: 'e-m3', source: 'root', target: 'm3', relationType: 'effect', label: '结果' },
        { id: 'e-m4', source: 'root', target: 'm4', relationType: 'duplicate', label: '重复' },
      ],
    };
    // 左侧、上侧都拖得很乱
    const pins = new Map([
      ['root', { x: 0, y: 0 }],
      ['idea1', { x: -400, y: -80, side: 'left' as const }],
      ['idea2', { x: -350, y: 120, side: 'left' as const }],
      ['test1', { x: -500, y: -40, side: 'left' as const }],
      ['test2', { x: -280, y: 200, side: 'left' as const }],
      ['m1', { x: -100, y: -300, side: 'top' as const }],
      ['m2', { x: 80, y: -250, side: 'top' as const }],
      ['m3', { x: 200, y: -400, side: 'top' as const }],
      ['m4', { x: -50, y: -180, side: 'top' as const }],
    ]);

    const next = tidyGraphLayout(wide, pins);
    const topY = next.get('m1')?.y;
    expect(topY).toBeDefined();
    for (const id of ['m2', 'm3', 'm4']) {
      expect(next.get(id)?.side).toBe('top');
      expect(next.get(id)?.y).toBeCloseTo(topY!, 0);
    }
    const leftX = next.get('idea1')?.x;
    expect(leftX).toBeDefined();
    for (const id of ['idea2', 'test1', 'test2']) {
      expect(next.get(id)?.side).toBe('left');
      expect(next.get(id)?.x).toBeCloseTo(leftX!, 0);
    }
    // 上侧高于左列顶；脊与分叉不被左列挤成一条
    const leftTop = Math.min(
      ...['idea1', 'idea2', 'test1', 'test2'].map((id) => next.get(id)!.y - GRAPH_NODE_SIZE.height / 2),
    );
    const topBottom = topY! + GRAPH_NODE_SIZE.height / 2;
    expect(topBottom).toBeLessThan(leftTop - 40);

    const { edges } = trunkEdges(wide, next);
    const mentionPts =
      (edges.find((edge) => edge.target === 'm1')?.style?.['controlPoints'] as [number, number][]) ??
      [];
    const spineY = mentionPts[0]?.[1];
    const forkY = mentionPts.find((p, i) => {
      const n = mentionPts[i + 1];
      return n && Math.abs(p[1] - n[1]) < 1 && Math.abs(p[0] - n[0]) > 8;
    })?.[1];
    expect(spineY).toBeDefined();
    expect(forkY).toBeDefined();
    expect(Math.abs((spineY ?? 0) - (forkY ?? 0))).toBeGreaterThan(40);
  });

  it('整组关联拖到左侧：整理后关联类仍在左侧并共线', () => {
    const pins = new Map([
      ['root', { x: 0, y: 0 }],
      ['p1', { x: 0, y: -200, side: 'top' as const }],
      ['m1', { x: -300, y: 40, side: 'left' as const }],
      ['m2', { x: -280, y: -60, side: 'left' as const }],
      ['t1', { x: 300, y: 0, side: 'right' as const }],
      ['c1', { x: 0, y: 200, side: 'bottom' as const }],
    ]);

    const next = tidyGraphLayout(graph, pins);
    expect(next.get('m1')?.side).toBe('left');
    expect(next.get('m2')?.side).toBe('left');
    expect(next.get('m1')?.x).toBeCloseTo(next.get('m2')?.x ?? NaN, 0);
    expect(next.get('p1')?.side).toBe('top');
  });

  it('父项被拖到左侧：整理后保留左侧方位（不强制回上）', () => {
    const pins = new Map([
      ['root', { x: 0, y: 0 }],
      ['p1', { x: -420, y: -40, side: 'left' as const }],
      ['m1', { x: -80, y: -280, side: 'top' as const }],
      ['m2', { x: 60, y: -260, side: 'top' as const }],
      ['t1', { x: -400, y: 80, side: 'left' as const }],
      ['c1', { x: 0, y: 220, side: 'bottom' as const }],
    ]);

    const next = tidyGraphLayout(graph, pins);
    expect(next.get('p1')?.side).toBe('left');
    expect((next.get('p1')?.x ?? 0) < 0).toBe(true);
    expect(next.get('c1')?.side).toBe('bottom');
    expect(next.get('t1')?.side).toBe('left');
  });
});
