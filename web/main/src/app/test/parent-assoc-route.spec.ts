import { describe, expect, it } from 'vitest';
import { GRAPH_NODE_SIZE } from '../constants/graph.constants';
import type { DependencyGraph } from '../entities/graph.entity';
import { arrangeGraph } from '../utils/arrange-graph';
import { trunkEdges, type GraphNodePosition } from '../utils/route-graph-edges';
import { toG6Data } from '../utils/to-g6-data';

const HALF_W = GRAPH_NODE_SIZE.width / 2;
const HALF_H = GRAPH_NODE_SIZE.height / 2;

function withBundleFold(graph: DependencyGraph): DependencyGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === graph.rootId
        ? {
            ...node,
            folds: [
              {
                key: `${graph.rootId}::bundle`,
                relationType: 'bundle',
                count: 2,
                expanded: true,
              },
            ],
          }
        : node,
    ),
  };
}

/** foldMarks「关联」→ 世界坐标（与 toG6Data 写入方式一致） */
function assocLabelWorld(
  graph: DependencyGraph,
  layout: Map<string, GraphNodePosition>,
): { x: number; y: number } | undefined {
  const rootId = graph.rootId;
  const rootPos = layout.get(rootId);
  if (!rootPos) {
    return undefined;
  }
  const g6 = toG6Data(graph, layout);
  const rootNode = g6.nodes?.find((node) => node.id === rootId);
  const mark = (
    (rootNode?.data?.['foldMarks'] as { text?: string; kind?: string; left?: number; top?: number }[]) ??
    []
  ).find((item) => item.kind === 'label' && item.text === '关联');
  if (!mark || mark.left == null || mark.top == null) {
    return undefined;
  }
  return {
    x: rootPos.x - HALF_W + mark.left,
    y: rootPos.y - HALF_H + mark.top,
  };
}

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

    // 「关联」文案改挂 foldMarks，干线锚点仍是 bundle fork
    expect(edges.some((edge) => edge.id === 'root:bundle:assoc-stem')).toBe(false);
    const bundleFold = forks.get('root::bundle');
    expect(bundleFold).toBeTruthy();
    // − 在组内分叉（类型线中心），不是骨干出线处
    const root = layout.get('root')!;
    expect(Math.abs((bundleFold?.y ?? 0) - root.y)).toBeGreaterThan(20);

    const g6 = toG6Data(withBundleFold(graph), layout);
    const rootNode = g6.nodes?.find((node) => node.id === 'root');
    const marks = (rootNode?.data?.['foldMarks'] as { text: string; kind?: string }[]) ?? [];
    expect(marks.some((mark) => mark.text === '−')).toBe(true);
    expect(marks.some((mark) => mark.text === '关联' && mark.kind === 'label')).toBe(true);
  });

  it('同侧拖卡冻结关联枢纽：关联 − 不跟着被拖卡跑', () => {
    const layout = arrangeGraph(graph);
    const freezeAt = layout.get('d1');
    expect(freezeAt).toBeTruthy();
    const moved = new Map(layout);
    moved.set('d1', { ...freezeAt!, x: (freezeAt!.x ?? 0) + 180, y: (freezeAt!.y ?? 0) + 120 });

    const live = trunkEdges(graph, moved);
    const frozen = trunkEdges(graph, moved, {
      freezeDrag: { id: 'd1', pos: freezeAt! },
    });
    const liveFold = live.forks.get('root::bundle');
    const frozenFold = frozen.forks.get('root::bundle');
    const baseFold = trunkEdges(graph, layout).forks.get('root::bundle');

    expect(frozenFold?.x).toBeCloseTo(baseFold?.x ?? NaN, 0);
    expect(frozenFold?.y).toBeCloseTo(baseFold?.y ?? NaN, 0);
    expect(
      Math.hypot((liveFold?.x ?? 0) - (baseFold?.x ?? 0), (liveFold?.y ?? 0) - (baseFold?.y ?? 0)),
    ).toBeGreaterThan(30);
  });

  it('拖关联组内叶卡后，「关联」文案世界坐标不变（无需人工点拖）', () => {
    const layout = arrangeGraph(graph);
    const withFolds = withBundleFold(graph);
    const before = assocLabelWorld(withFolds, layout);
    expect(before).toBeTruthy();

    const m1 = layout.get('m1')!;
    const moved = new Map(layout);
    moved.set('m1', { ...m1, x: m1.x + 280, y: m1.y + 220 });
    const d1 = layout.get('d1')!;
    moved.set('d1', { ...d1, x: d1.x - 160, y: d1.y + 180 });

    const after = assocLabelWorld(withFolds, moved);
    expect(after!.x).toBeCloseTo(before!.x, 5);
    expect(after!.y).toBeCloseTo(before!.y, 5);

    // hub 仍会被叶卡拉走，证明文案没有误钉在 hub 上
    const baseHub = trunkEdges(graph, layout).forks.get('root::bundle');
    const movedHub = trunkEdges(graph, moved).forks.get('root::bundle');
    expect(
      Math.hypot((movedHub?.x ?? 0) - (baseHub?.x ?? 0), (movedHub?.y ?? 0) - (baseHub?.y ?? 0)),
    ).toBeGreaterThan(40);
  });

  it('拖父卡时「关联」文案随父卡平移', () => {
    const layout = arrangeGraph(graph);
    const withFolds = withBundleFold(graph);
    const before = assocLabelWorld(withFolds, layout)!;
    const root = layout.get('root')!;
    const dx = 120;
    const dy = -80;
    const moved = new Map(layout);
    moved.set('root', { ...root, x: root.x + dx, y: root.y + dy });
    // 子卡相对父卡一起平移，模拟整组拖父
    for (const id of ['m1', 'd1', 'p1', 't1'] as const) {
      const pin = layout.get(id);
      if (pin) {
        moved.set(id, { ...pin, x: pin.x + dx, y: pin.y + dy });
      }
    }
    const after = assocLabelWorld(withFolds, moved)!;
    expect(after.x - before.x).toBeCloseTo(dx, 5);
    expect(after.y - before.y).toBeCloseTo(dy, 5);
  });

  it('上侧关联时「关联」在父卡上方，不落到子工作项方向', () => {
    const layout = arrangeGraph(graph);
    const root = layout.get('root')!;
    const label = trunkEdges(graph, layout).forks.get('root::bundle:label');
    expect(label).toBeTruthy();
    expect(label!.y).toBeLessThan(root.y - 20);
    expect(label!.x).toBeCloseTo(root.x, 0);
  });

  it('父拖到右侧后，上方位关联类仍保留「关联」干', () => {
    const preferred = new Map([['parent', 'right' as const]]);
    const layout = arrangeGraph(graph, preferred);
    expect(layout.get('p1')?.side).toBe('right');
    expect(layout.get('m1')?.side ?? 'top').toBe('top');

    const { forks } = trunkEdges(graph, layout);
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

    const { forks } = trunkEdges(graph, layout);
    expect(forks.has('root::bundle')).toBe(true);
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
    expect(trunkEdges(mixed, layout).forks.has('root::bundle')).toBe(true);
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
    expect(trunkEdges(mixed, layout).forks.has('root::bundle')).toBe(true);
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
    const { edges, forks } = trunkEdges(rightOnly, rightLayout);
    expect(forks.has('root::bundle')).toBe(false);
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
    const { forks } = trunkEdges(parentOnly, layout);
    expect(forks.has('root::bundle')).toBe(false);
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
