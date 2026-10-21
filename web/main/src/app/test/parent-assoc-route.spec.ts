import { describe, expect, it } from 'vitest';
import type { DependencyGraph } from '../entities/graph.entity';
import { arrangeGraph } from '../utils/arrange-graph';
import { trunkEdges } from '../utils/route-graph-edges';

const graph: DependencyGraph = {
  rootId: 'root',
  depth: 2,
  nodes: [
    { id: 'root', title: 'root', depth: 0 },
    { id: 'p1', title: 'parent', depth: 1, revealedByAnchorId: 'root' },
    { id: 'm1', title: 'mention', depth: 1, revealedByAnchorId: 'root' },
    { id: 'd1', title: 'dup', depth: 1, revealedByAnchorId: 'root' },
    { id: 't1', title: 'ticket', depth: 1, revealedByAnchorId: 'root' },
  ],
  edges: [
    { id: 'e-p', source: 'root', target: 'p1', relationType: 'parent', label: '父工作项' },
    { id: 'e-m', source: 'root', target: 'm1', relationType: 'mention', label: '提及' },
    { id: 'e-d', source: 'root', target: 'd1', relationType: 'duplicate', label: '重复' },
    { id: 'e-t', source: 'root', target: 't1', relationType: 'relate:ticket', label: '关联工单' },
  ],
};

function spineOf(
  pts: [number, number][],
  side: 'left' | 'right' | 'top' | 'bottom',
): number | undefined {
  // 公共脊：左右为第一段水平后的 x；上下为第一段竖直后的 y
  if (side === 'left' || side === 'right') {
    return pts[1]?.[0];
  }
  return pts[0]?.[1];
}

describe('关联干线', () => {
  it('上方位父+关联：同侧一条骨干；关联为独立类型支并有文案', () => {
    const layout = arrangeGraph(graph);
    const { edges, forks } = trunkEdges(graph, layout);
    const parentPts =
      (edges.find((edge) => edge.target === 'p1')?.style?.['controlPoints'] as [number, number][]) ??
      [];
    const mentionPts =
      (edges.find((edge) => edge.target === 'm1')?.style?.['controlPoints'] as [number, number][]) ??
      [];
    const dupPts =
      (edges.find((edge) => edge.target === 'd1')?.style?.['controlPoints'] as [number, number][]) ??
      [];

    expect(spineOf(parentPts, 'top')).toBeCloseTo(spineOf(mentionPts, 'top') ?? NaN, 0);
    // 关联组内共用类型线中心（独立分叉，非各自从骨干散开）
    expect(mentionPts[1]?.[0]).toBeCloseTo(dupPts[1]?.[0] ?? NaN, 0);
    // 父支与关联支类型线中心分离
    expect(Math.abs((parentPts[1]?.[0] ?? 0) - (mentionPts[1]?.[0] ?? 0))).toBeGreaterThan(20);

    const stem = edges.find((edge) => edge.id === 'root:bundle:assoc-stem');
    expect(stem?.data?.['label']).toBe('关联');
    expect(stem?.data?.['labelOnly']).toBe(true);
    const bundleFold = forks.get('root::bundle');
    expect(bundleFold).toBeTruthy();
    // − 在组内分叉（类型线中心），不是骨干出线处
    const root = layout.get('root')!;
    expect(Math.abs((bundleFold?.y ?? 0) - root.y)).toBeGreaterThan(20);
  });

  it('父拖到右侧后，上方位关联类仍保留「关联」干', () => {
    const preferred = new Map([['parent', 'right' as const]]);
    const layout = arrangeGraph(graph, preferred);
    expect(layout.get('p1')?.side).toBe('right');
    expect(layout.get('m1')?.side ?? 'top').toBe('top');

    const { edges, forks } = trunkEdges(graph, layout);
    expect(edges.some((edge) => edge.id === 'root:bundle:assoc-stem')).toBe(true);
    expect(edges.find((edge) => edge.id === 'root:bundle:assoc-stem')?.data?.['label']).toBe(
      '关联',
    );
    expect(forks.has('root::bundle')).toBe(true);
  });

  it('关联类拖到左侧：左侧也展示「关联」干', () => {
    const preferred = new Map([
      ['parent', 'top' as const],
      ['bundle', 'left' as const],
    ]);
    const layout = arrangeGraph(graph, preferred);
    expect(layout.get('m1')?.side).toBe('left');
    expect(layout.get('d1')?.side).toBe('left');

    const { edges } = trunkEdges(graph, layout);
    expect(edges.some((edge) => edge.id === 'root:bundle:assoc-stem')).toBe(true);
  });

  it('关联与子工作项同侧：共一条骨干再分叉', () => {
    const mixed: DependencyGraph = {
      rootId: 'root',
      depth: 1,
      nodes: [
        { id: 'root', title: 'root', depth: 0 },
        { id: 'm1', title: 'mention', depth: 1, revealedByAnchorId: 'root' },
        { id: 'c1', title: 'child', depth: 1, revealedByAnchorId: 'root' },
      ],
      edges: [
        { id: 'e-m', source: 'root', target: 'm1', relationType: 'mention', label: '提及' },
        { id: 'e-c', source: 'root', target: 'c1', relationType: 'child', label: '子工作项' },
      ],
    };
    const preferred = new Map([['bundle', 'bottom' as const]]);
    const layout = arrangeGraph(mixed, preferred);
    const { edges } = trunkEdges(mixed, layout);
    const mentionPts =
      (edges.find((edge) => edge.target === 'm1')?.style?.['controlPoints'] as [
        number,
        number,
      ][]) ?? [];
    const childPts =
      (edges.find((edge) => edge.target === 'c1')?.style?.['controlPoints'] as [
        number,
        number,
      ][]) ?? [];
    expect(spineOf(mentionPts, 'bottom')).toBeCloseTo(spineOf(childPts, 'bottom') ?? NaN, 0);
    expect(Math.abs((mentionPts[1]?.[0] ?? 0) - (childPts[1]?.[0] ?? 0))).toBeGreaterThan(20);
    expect(edges.some((edge) => edge.id === 'root:bundle:assoc-stem')).toBe(true);
  });

  it('关联与关联工单同侧：共一条骨干再分叉（关联不吞工单）', () => {
    const mixed: DependencyGraph = {
      rootId: 'root',
      depth: 1,
      nodes: [
        { id: 'root', title: 'root', depth: 0 },
        { id: 'm1', title: 'mention', depth: 1, revealedByAnchorId: 'root' },
        { id: 't1', title: 'ticket', depth: 1, revealedByAnchorId: 'root' },
      ],
      edges: [
        { id: 'e-m', source: 'root', target: 'm1', relationType: 'mention', label: '提及' },
        {
          id: 'e-t',
          source: 'root',
          target: 't1',
          relationType: 'relate:ticket',
          label: '关联工单',
        },
      ],
    };
    const preferred = new Map([
      ['bundle', 'right' as const],
      ['relate:ticket', 'right' as const],
    ]);
    const layout = arrangeGraph(mixed, preferred);
    const { edges } = trunkEdges(mixed, layout);
    const mentionPts =
      (edges.find((edge) => edge.target === 'm1')?.style?.['controlPoints'] as [
        number,
        number,
      ][]) ?? [];
    const ticketPts =
      (edges.find((edge) => edge.target === 't1')?.style?.['controlPoints'] as [
        number,
        number,
      ][]) ?? [];
    expect(spineOf(mentionPts, 'right')).toBeCloseTo(spineOf(ticketPts, 'right') ?? NaN, 0);
    expect(Math.abs((mentionPts[2]?.[1] ?? 0) - (ticketPts[2]?.[1] ?? 0))).toBeGreaterThan(20);
    expect(edges.some((edge) => edge.id === 'root:bundle:assoc-stem')).toBe(true);
  });

  it('左右专属关系（关联工单）不画「关联」干', () => {
    const preferred = new Map([
      ['parent', 'right' as const],
      ['mention', 'top' as const],
      ['duplicate', 'top' as const],
    ]);
    const rightOnly: DependencyGraph = {
      ...graph,
      nodes: graph.nodes.filter((node) => node.id === 'root' || node.id === 'p1' || node.id === 't1'),
      edges: graph.edges.filter((edge) => edge.target === 'p1' || edge.target === 't1'),
    };
    const rightLayout = arrangeGraph(rightOnly, preferred);
    const { edges } = trunkEdges(rightOnly, rightLayout);
    expect(edges.some((edge) => edge.id === 'root:bundle:assoc-stem')).toBe(false);
    expect(edges.filter((edge) => edge.data?.['label'] === '关联')).toHaveLength(0);
  });

  it('仅父无关联：普通出线', () => {
    const parentOnly: DependencyGraph = {
      rootId: 'root',
      depth: 1,
      nodes: [
        { id: 'root', title: 'root', depth: 0 },
        { id: 'p1', title: 'parent', depth: 1, revealedByAnchorId: 'root' },
      ],
      edges: [
        { id: 'e-p', source: 'root', target: 'p1', relationType: 'parent', label: '父工作项' },
      ],
    };
    const layout = arrangeGraph(parentOnly);
    const { edges } = trunkEdges(parentOnly, layout);
    expect(edges.some((edge) => edge.id === 'root:bundle:assoc-stem')).toBe(false);
  });

  it('左右专属关系保留公共脊，类型线不被压成 fork', () => {
    const exclusive: DependencyGraph = {
      rootId: 'root',
      depth: 1,
      nodes: [
        { id: 'root', title: 'root', depth: 0 },
        { id: 'idea', title: 'idea', depth: 1, revealedByAnchorId: 'root' },
        { id: 'test', title: 'test', depth: 1, revealedByAnchorId: 'root' },
      ],
      edges: [
        {
          id: 'e-i',
          source: 'root',
          target: 'idea',
          relationType: 'relate:idea',
          label: '关联产品需求',
        },
        {
          id: 'e-c',
          source: 'root',
          target: 'test',
          relationType: 'relate:test_case',
          label: '关联测试',
        },
      ],
    };
    const preferred = new Map([
      ['relate:idea', 'left' as const],
      ['relate:test_case', 'left' as const],
    ]);
    const layout = arrangeGraph(exclusive, preferred);
    const { edges } = trunkEdges(exclusive, layout);
    const pts =
      (edges.find((edge) => edge.target === 'idea')?.style?.['controlPoints'] as [
        number,
        number,
      ][]) ?? [];
    const typeSeg = pts.find((point, index) => {
      const next = pts[index + 1];
      return next && Math.abs(point[1] - next[1]) < 1 && Math.abs(point[0] - next[0]) > 20;
    });
    expect(typeSeg).toBeTruthy();
  });
});
