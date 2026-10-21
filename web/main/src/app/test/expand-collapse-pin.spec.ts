import { describe, expect, it } from 'vitest';
import type { DependencyGraph } from '../entities/graph.entity';
import { CanvasPositionSession } from '../utils/canvas-position-session';
import type { GraphNodePosition } from '../utils/to-g6-data';

function parentFoldFixture(): {
  collapsed: DependencyGraph;
  expanded: DependencyGraph;
  foldId: string;
  parentId: string;
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
  return { collapsed, expanded, foldId, parentId };
}

describe('父工作项拖拽不再整组重锚', () => {
  it('松手写 side 时不写入 parent 关系偏好', () => {
    const { expanded, parentId } = parentFoldFixture();
    const session = new CanvasPositionSession();
    session.seed(
      new Map<string, GraphNodePosition>([
        ['root', { x: 0, y: 0 }],
        [parentId, { x: -300, y: 40, side: 'left' }],
      ]),
    );
    // 模拟松手 snapshot 的 applyDragSide：无 g6，直接验证偏好不被父卡污染
    const fakeG6 = {
      getNodeData: () => [{ id: 'root' }, { id: parentId }],
      getElementPosition: (id: string) => {
        if (id === 'root') {
          return [0, 0];
        }
        return [-300, 40];
      },
    };
    session.snapshot(fakeG6 as never, expanded, parentId, true);
    expect(session.getRelationSides()).toEqual({});
  });
});

describe('关联整体 fold 换侧后展开', () => {
  it('拖到右侧并保存偏好后展开：子卡跟右侧，不回上方位', () => {
    const rootId = 'root';
    const foldId = `fold:${rootId}::bundle`;
    const mentionId = 'm1';
    const collapsed: DependencyGraph = {
      rootId,
      depth: 1,
      nodes: [
        { id: rootId, title: 'root', depth: 0 },
        {
          id: foldId,
          title: '+ 1',
          depth: 1,
          revealedByAnchorId: rootId,
          foldSummary: {
            key: `${rootId}::bundle`,
            relationType: 'bundle',
            count: 1,
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
      ],
      edges: [
        {
          id: 'e-m',
          source: rootId,
          target: mentionId,
          relationType: 'mention',
          label: '提及',
        },
      ],
    };
    const session = new CanvasPositionSession();
    session.setRelationSides({ bundle: 'right' });
    session.replaceSaved(
      new Map<string, GraphNodePosition>([
        [rootId, { x: 0, y: 0 }],
        [foldId, { x: 220, y: 0, side: 'right' }],
        // 旧个人视图仍记在上方位，展开后应被换侧重锚覆盖
        [mentionId, { x: 0, y: -180, side: 'top' }],
      ]),
    );
    session.seed(
      new Map<string, GraphNodePosition>([
        [rootId, { x: 0, y: 0 }],
        [foldId, { x: 220, y: 0, side: 'right' }],
        [mentionId, { x: 0, y: -180, side: 'top' }],
      ]),
    );
    session.rememberGraph(collapsed);

    const layout = session.resolveExpandCollapse(expanded);
    const mention = layout.get(mentionId);
    expect(mention?.side).toBe('right');
    expect((mention?.x ?? 0) > 0).toBe(true);
  });
});

describe('resolveExpandCollapse pin vs saved', () => {
  it('拖动父卡后收起再展开：保留 pin，不被旧 saved 盖回', () => {
    const { collapsed, expanded, parentId } = parentFoldFixture();
    const session = new CanvasPositionSession();
    const savedParent: GraphNodePosition = { x: -180, y: 0, side: 'left' };
    const draggedParent: GraphNodePosition = { x: -320, y: 80, side: 'left' };

    session.replaceSaved(
      new Map<string, GraphNodePosition>([
        ['root', { x: 0, y: 0 }],
        [parentId, savedParent],
      ]),
    );
    session.seed(
      new Map<string, GraphNodePosition>([
        ['root', { x: 0, y: 0 }],
        [parentId, draggedParent],
      ]),
    );
    session.rememberGraph(expanded);

    session.resolveExpandCollapse(collapsed);
    const layout = session.resolveExpandCollapse(expanded);

    expect(layout.get(parentId)).toMatchObject(draggedParent);
  });
});

describe('CanvasPositionSession.clear', () => {
  it('清空 pin/saved 时保留用户级 relationSides', () => {
    const session = new CanvasPositionSession();
    session.setRelationSides({ bundle: 'top', child: 'bottom', parent: 'top' });
    session.seed(new Map([['root', { x: 0, y: 0 }]]));
    session.clear();
    expect(session.getRelationSides()).toEqual({
      bundle: 'top',
      child: 'bottom',
      parent: 'top',
    });
    expect(session.pins.size).toBe(0);
  });
});
