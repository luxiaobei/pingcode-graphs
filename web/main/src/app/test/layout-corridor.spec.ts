import { describe, expect, it } from 'vitest';
import { GRAPH_NODE_SIZE } from '../constants/graph.constants';
import { LAYOUT_V_BESIDE_ROUTE_CLEAR, LAYOUT_V_GAP } from '../constants/layout.constants';
import type { DependencyGraph } from '../entities/graph.entity';
import { arrangeGraph } from '../utils/arrange-graph';
import { trunkEdges } from '../utils/route-graph-edges';
import { tidyGraphLayout } from '../utils/tidy-graph-layout';

describe('布局出线走廊', () => {
  const graph: DependencyGraph = {
    rootId: 'root',
    depth: 1,
    nodes: [
      { id: 'root', title: 'root', depth: 0 },
      { id: 'idea1', title: 'i1', depth: 1, revealedByAnchorId: 'root' },
      { id: 'idea2', title: 'i2', depth: 1, revealedByAnchorId: 'root' },
      { id: 'idea3', title: 'i3', depth: 1, revealedByAnchorId: 'root' },
      { id: 'idea4', title: 'i4', depth: 1, revealedByAnchorId: 'root' },
      { id: 'm1', title: 'm1', depth: 1, revealedByAnchorId: 'root' },
      { id: 'm2', title: 'm2', depth: 1, revealedByAnchorId: 'root' },
      { id: 'm3', title: 'm3', depth: 1, revealedByAnchorId: 'root' },
    ],
    edges: [
      { id: 'e-i1', source: 'root', target: 'idea1', relationType: 'relate:idea', label: '需求' },
      { id: 'e-i2', source: 'root', target: 'idea2', relationType: 'relate:idea', label: '需求' },
      { id: 'e-i3', source: 'root', target: 'idea3', relationType: 'relate:idea', label: '需求' },
      { id: 'e-i4', source: 'root', target: 'idea4', relationType: 'relate:idea', label: '需求' },
      { id: 'e-m1', source: 'root', target: 'm1', relationType: 'mention', label: '提及' },
      { id: 'e-m2', source: 'root', target: 'm2', relationType: 'cause', label: '原因' },
      { id: 'e-m3', source: 'root', target: 'm3', relationType: 'effect', label: '结果' },
    ],
  };

  it('初始化：左列存在时上侧相对列顶至少拉开 V_GAP+CLEAR', () => {
    const layout = arrangeGraph(graph);
    const leftTop = Math.min(
      ...['idea1', 'idea2', 'idea3', 'idea4'].map(
        (id) => (layout.get(id)?.y ?? 0) - GRAPH_NODE_SIZE.height / 2,
      ),
    );
    const topBottom = Math.max(
      ...['m1', 'm2', 'm3'].map((id) => (layout.get(id)?.y ?? 0) + GRAPH_NODE_SIZE.height / 2),
    );
    expect(leftTop - topBottom).toBeGreaterThanOrEqual(LAYOUT_V_GAP + LAYOUT_V_BESIDE_ROUTE_CLEAR - 1);
  });

  it('初始化仅上侧关联：公共脊与分叉拉开，第二脊不越过分叉', () => {
    const topOnly: DependencyGraph = {
      rootId: 'root',
      depth: 1,
      nodes: [
        { id: 'root', title: 'root', depth: 0 },
        { id: 'm1', title: 'm1', depth: 1, revealedByAnchorId: 'root' },
        { id: 'm2', title: 'm2', depth: 1, revealedByAnchorId: 'root' },
        { id: 'm3', title: 'm3', depth: 1, revealedByAnchorId: 'root' },
      ],
      edges: [
        { id: 'e-m1', source: 'root', target: 'm1', relationType: 'mention', label: '提及' },
        { id: 'e-m2', source: 'root', target: 'm2', relationType: 'cause', label: '原因' },
        { id: 'e-m3', source: 'root', target: 'm3', relationType: 'effect', label: '结果' },
      ],
    };
    const layout = arrangeGraph(topOnly);
    const rootTop = -GRAPH_NODE_SIZE.height / 2;
    const cardBottom = (layout.get('m1')?.y ?? 0) + GRAPH_NODE_SIZE.height / 2;
    expect(rootTop - cardBottom).toBeGreaterThanOrEqual(LAYOUT_V_GAP - 1);

    const { edges } = trunkEdges(topOnly, layout);
    const pts =
      (edges.find((edge) => edge.target === 'm1' && !edge.data?.['labelOnly'])?.style?.[
        'controlPoints'
      ] as [number, number][]) ?? [];
    const uniqueYs = [...new Set(pts.map((p) => Math.round(p[1])))].sort((a, b) => b - a);
    expect(uniqueYs.length).toBeGreaterThanOrEqual(2);
    const spineY = uniqueYs[0]!;
    const forkY = uniqueYs[uniqueYs.length - 1]!;
    expect(spineY - forkY).toBeGreaterThan(48);
    for (const y of uniqueYs.slice(1, -1)) {
      expect(y).toBeLessThan(spineY);
      expect(y).toBeGreaterThan(forkY);
    }
  });

  it('左列不挤扁上侧关联出线：脊与分叉间距足够', () => {
    const layout = arrangeGraph(graph);
    const { edges } = trunkEdges(graph, layout);
    const pts =
      (edges.find((edge) => edge.target === 'm1')?.style?.['controlPoints'] as [number, number][]) ??
      [];
    const spineY = pts[0]?.[1];
    const forkY = pts.find((point, index) => {
      const next = pts[index + 1];
      return next && Math.abs(point[1] - next[1]) < 1 && Math.abs(point[0] - next[0]) > 8;
    })?.[1];
    expect(spineY).toBeDefined();
    expect(forkY).toBeDefined();
    expect(Math.abs((spineY ?? 0) - (forkY ?? 0))).toBeGreaterThan(40);
  });

  it('初始化：上侧关联横线不穿过左右列卡片', () => {
    const layout = arrangeGraph(graph);
    const { edges } = trunkEdges(graph, layout);
    const halfH = GRAPH_NODE_SIZE.height / 2;
    const halfW = GRAPH_NODE_SIZE.width / 2;
    const leftBoxes = ['idea1', 'idea2', 'idea3', 'idea4'].map((id) => {
      const pos = layout.get(id)!;
      return {
        left: pos.x - halfW,
        right: pos.x + halfW,
        top: pos.y - halfH,
        bottom: pos.y + halfH,
      };
    });
    for (const target of ['m1', 'm2', 'm3'] as const) {
      const pts =
        (edges.find((edge) => edge.target === target && !edge.data?.['labelOnly'])?.style?.[
          'controlPoints'
        ] as [number, number][]) ?? [];
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        if (Math.abs(a[1] - b[1]) > 1 || Math.abs(a[0] - b[0]) < 8) {
          continue;
        }
        const y = a[1];
        const x0 = Math.min(a[0], b[0]);
        const x1 = Math.max(a[0], b[0]);
        for (const box of leftBoxes) {
          const overlapX = x1 >= box.left && x0 <= box.right;
          const throughY = y >= box.top - 1 && y <= box.bottom + 1;
          expect(overlapX && throughY).toBe(false);
        }
      }
    }
  });

  it('一键整理：乱拖后仍保持上侧共线且出线不被挤扁', () => {
    const pins = new Map([
      ['root', { x: 0, y: 0 }],
      ['idea1', { x: -400, y: -120, side: 'left' as const }],
      ['idea2', { x: -350, y: 40, side: 'left' as const }],
      ['idea3', { x: -420, y: 160, side: 'left' as const }],
      ['idea4', { x: -300, y: -40, side: 'left' as const }],
      ['m1', { x: -80, y: -280, side: 'top' as const }],
      ['m2', { x: 60, y: -220, side: 'top' as const }],
      ['m3', { x: 180, y: -360, side: 'top' as const }],
    ]);
    const next = tidyGraphLayout(graph, pins);
    expect(next.get('m1')?.y).toBeCloseTo(next.get('m2')?.y ?? NaN, 0);
    expect(next.get('m2')?.y).toBeCloseTo(next.get('m3')?.y ?? NaN, 0);

    const { edges } = trunkEdges(graph, next);
    const pts =
      (edges.find((edge) => edge.target === 'm2')?.style?.['controlPoints'] as [number, number][]) ??
      [];
    const spineY = pts[0]?.[1];
    const forkY = pts.find((point, index) => {
      const n = pts[index + 1];
      return n && Math.abs(point[1] - n[1]) < 1 && Math.abs(point[0] - n[0]) > 8;
    })?.[1];
    expect(Math.abs((spineY ?? 0) - (forkY ?? 0))).toBeGreaterThan(40);
  });
});
