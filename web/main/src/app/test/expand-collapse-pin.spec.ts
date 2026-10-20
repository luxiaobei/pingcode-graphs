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
