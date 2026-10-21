import { describe, expect, it } from 'vitest';
import type { DependencyGraph } from '../entities/graph.entity';
import {
  clearStalePinsAfterFoldDrag,
  placeFoldsAtExpandedSlots,
  syncRelationSidesFromFolds,
} from '../utils/fold-layout';
import type { GraphNodePosition } from '../utils/to-g6-data';

function parentFoldFixture(): {
  collapsed: DependencyGraph;
  expanded: DependencyGraph;
  foldId: string;
} {
  const rootId = 'root';
  const parentId = 'parent-1';
  const foldKey = `${rootId}::parent`;
  const foldId = `fold:${foldKey}`;
  const collapsed: DependencyGraph = {
    rootId,
    depth: 2,
    nodes: [
      { id: rootId, title: 'root', depth: 0 },
      {
        id: foldId,
        title: '+ 1',
        depth: 1,
        revealedByAnchorId: rootId,
        foldSummary: { key: foldKey, relationType: 'parent', count: 1, expanded: false },
      },
    ],
    edges: [
      {
        id: 'e-fold',
        source: rootId,
        target: foldId,
        relationType: 'parent',
        label: '父工作项',
      },
    ],
  };
  const expanded: DependencyGraph = {
    rootId,
    depth: 2,
    nodes: [
      { id: rootId, title: 'root', depth: 0 },
      { id: parentId, title: 'parent', depth: 1, revealedByAnchorId: rootId },
    ],
    edges: [
      {
        id: 'e-parent',
        source: rootId,
        target: parentId,
        relationType: 'parent',
        label: '父工作项',
      },
    ],
  };
  return { collapsed, expanded, foldId };
}

function childFoldFixture(): {
  collapsed: DependencyGraph;
  expanded: DependencyGraph;
  foldId: string;
  childIds: string[];
} {
  const rootId = 'anchor';
  const foldKey = `${rootId}::child`;
  const foldId = `fold:${foldKey}`;
  const childIds = ['c1', 'c2'];
  const collapsed: DependencyGraph = {
    rootId,
    depth: 2,
    nodes: [
      { id: rootId, depth: 0 },
      {
        id: foldId,
        title: '+ 2',
        depth: 1,
        revealedByAnchorId: rootId,
        foldSummary: { key: foldKey, relationType: 'child', count: 2, expanded: false },
      },
    ],
    edges: [
      {
        id: 'e-fold',
        source: rootId,
        target: foldId,
        relationType: 'child',
        label: '子工作项',
      },
    ],
  };
  const expanded: DependencyGraph = {
    rootId,
    depth: 2,
    nodes: [
      { id: rootId, depth: 0 },
      ...childIds.map((id) => ({ id, depth: 1, revealedByAnchorId: rootId })),
    ],
    edges: childIds.map((id) => ({
      id: `e-${id}`,
      source: rootId,
      target: id,
      relationType: 'child' as const,
      label: '子工作项',
    })),
  };
  return { collapsed, expanded, foldId, childIds };
}

describe('clearStalePinsAfterFoldDrag', () => {
  it('父项 fold 拖到左侧后展开：清掉上侧 pin 并返回重锚簇', () => {
    const { collapsed, expanded, foldId } = parentFoldFixture();
    const parentId = 'parent-1';
    const pins = new Map<string, GraphNodePosition>([
      ['root', { x: 0, y: 0 }],
      [foldId, { x: -180, y: 0, side: 'left' }],
      [parentId, { x: 0, y: -160, side: 'top' }],
    ]);
    const foldPins = new Map([[foldId, pins.get(foldId)!]]);

    const clusters = clearStalePinsAfterFoldDrag(expanded, collapsed, foldPins, pins);

    expect(pins.has(parentId)).toBe(false);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.side).toBe('left');
    expect(clusters[0]?.ids.has(parentId)).toBe(true);
    expect(clusters[0]?.anchor).toEqual({ x: -180, y: 0 });
  });

  it('子孙 child fold 拖到右侧后展开：清掉下方旧 pin', () => {
    const { collapsed, expanded, foldId, childIds } = childFoldFixture();
    const pins = new Map<string, GraphNodePosition>([
      ['anchor', { x: 0, y: 0 }],
      [foldId, { x: 200, y: 0, side: 'right' }],
      [childIds[0]!, { x: -40, y: 160, side: 'bottom' }],
      [childIds[1]!, { x: 40, y: 160, side: 'bottom' }],
    ]);
    const foldPins = new Map([[foldId, pins.get(foldId)!]]);

    const clusters = clearStalePinsAfterFoldDrag(expanded, collapsed, foldPins, pins);

    expect(childIds.every((id) => !pins.has(id))).toBe(true);
    expect(clusters[0]?.side).toBe('right');
    expect(clusters[0]?.ids.size).toBe(2);
  });

  it('side 已与 fold 一致时不重锚', () => {
    const { collapsed, expanded, foldId } = parentFoldFixture();
    const parentId = 'parent-1';
    const pins = new Map<string, GraphNodePosition>([
      ['root', { x: 0, y: 0 }],
      [foldId, { x: -180, y: 0, side: 'left' }],
      [parentId, { x: -180, y: 10, side: 'left' }],
    ]);
    const foldPins = new Map([[foldId, pins.get(foldId)!]]);

    expect(clearStalePinsAfterFoldDrag(expanded, collapsed, foldPins, pins)).toHaveLength(0);
    expect(pins.has(parentId)).toBe(true);
  });

  it('「关联」整体 fold 拖到右侧后展开：清掉上侧 mention/重复等 pin', () => {
    const rootId = 'root';
    const foldId = `fold:${rootId}::bundle`;
    const mentionId = 'm1';
    const dupId = 'd1';
    const collapsed: DependencyGraph = {
      rootId,
      depth: 1,
      nodes: [
        { id: rootId, title: 'root', depth: 0 },
        {
          id: foldId,
          title: '+ 2',
          depth: 1,
          revealedByAnchorId: rootId,
          foldSummary: {
            key: `${rootId}::bundle`,
            relationType: 'bundle',
            count: 2,
            expanded: false,
          },
        },
      ],
      edges: [
        {
          id: 'e-fold',
          source: rootId,
          target: foldId,
          relationType: 'bundle',
          label: '关联',
        },
      ],
    };
    const expanded: DependencyGraph = {
      rootId,
      depth: 1,
      nodes: [
        { id: rootId, title: 'root', depth: 0 },
        { id: mentionId, title: 'mention', depth: 1, revealedByAnchorId: rootId },
        { id: dupId, title: 'dup', depth: 1, revealedByAnchorId: rootId },
      ],
      edges: [
        {
          id: 'e-m',
          source: rootId,
          target: mentionId,
          relationType: 'mention',
          label: '提及',
        },
        {
          id: 'e-d',
          source: rootId,
          target: dupId,
          relationType: 'duplicate',
          label: '重复',
        },
      ],
    };
    const pins = new Map<string, GraphNodePosition>([
      [rootId, { x: 0, y: 0 }],
      [foldId, { x: 220, y: 0, side: 'right' }],
      [mentionId, { x: -40, y: -160, side: 'top' }],
      [dupId, { x: 40, y: -160, side: 'top' }],
    ]);
    const foldPins = new Map([[foldId, pins.get(foldId)!]]);

    const clusters = clearStalePinsAfterFoldDrag(expanded, collapsed, foldPins, pins);

    expect(pins.has(mentionId)).toBe(false);
    expect(pins.has(dupId)).toBe(false);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.side).toBe('right');
    expect(clusters[0]?.ids.has(mentionId)).toBe(true);
    expect(clusters[0]?.ids.has(dupId)).toBe(true);
  });
});

describe('syncRelationSidesFromFolds', () => {
  it('把 fold pin.side 写入关系偏好', () => {
    const { collapsed, foldId } = parentFoldFixture();
    const relationSides = new Map<string, 'left' | 'right' | 'top' | 'bottom'>();
    syncRelationSidesFromFolds(
      collapsed,
      new Map([[foldId, { x: -100, y: 0, side: 'left' }]]),
      relationSides,
    );
    expect(relationSides.get('parent')).toBe('left');
  });
});

describe('placeFoldsAtExpandedSlots', () => {
  it('优先保留已拖动的 fold pin 坐标与 side', () => {
    const { collapsed, foldId } = childFoldFixture();
    const layout = new Map<string, GraphNodePosition>([
      ['anchor', { x: 0, y: 0 }],
      [foldId, { x: 0, y: 120, side: 'bottom' }],
    ]);
    const foldPins = new Map([[foldId, { x: 220, y: 10, side: 'right' as const }]]);
    const relationSides = new Map<string, 'left' | 'right' | 'top' | 'bottom'>();

    placeFoldsAtExpandedSlots(collapsed, collapsed, new Map(), layout, foldPins, relationSides);

    expect(layout.get(foldId)).toMatchObject({ x: 220, y: 10, side: 'right' });
    expect(relationSides.get('child')).toBe('right');
  });

  it('无 fold pin 时对齐到展开子卡中心', () => {
    const { collapsed, expanded, foldId, childIds } = childFoldFixture();
    const pins = new Map<string, GraphNodePosition>([
      ['anchor', { x: 0, y: 0 }],
      [childIds[0]!, { x: -50, y: 100, side: 'bottom' }],
      [childIds[1]!, { x: 50, y: 100, side: 'bottom' }],
    ]);
    const layout = new Map<string, GraphNodePosition>([
      ['anchor', { x: 0, y: 0 }],
      [foldId, { x: 999, y: 999 }],
    ]);

    placeFoldsAtExpandedSlots(collapsed, expanded, pins, layout, new Map(), new Map());

    expect(layout.get(foldId)).toMatchObject({ x: 0, y: 100, side: 'bottom' });
  });
});
