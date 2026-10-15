import { idea, page, testcase, ticket, workitem } from '@pc-nexus/capabilities';
import { NavigationTarget } from '@pc-nexus/bridge';
import { DEFAULT_EDGE_COLOR, RELATION_STYLE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';
import type { RelationType } from '../enums/graph.enum';
import { isRelationShown, type DisplaySetting } from '../settings/display-settings';

/** 关系线颜色 */
export function relationColor(type: RelationType): string {
  return RELATION_STYLE[type]?.color ?? DEFAULT_EDGE_COLOR;
}

/** 关系展示名（阻塞、关联等） */
export function relationLabel(type: RelationType, fallback?: string): string {
  return RELATION_STYLE[type]?.label ?? fallback ?? type;
}

/** 展开收起 / 分叉 key：`父节点::关系类型` */
export function relationFoldKey(parentId: string, relationType: string): string {
  return `${parentId}::${relationType}`;
}

/** 折叠占位节点 id */
export function foldSummaryNodeId(foldKey: string): string {
  return `fold:${foldKey}`;
}

/** 是否为折叠「+ N」占位 */
export function isFoldSummaryNode(node: GraphEntity | null | undefined): boolean {
  return Boolean(node?.foldSummary);
}

/** 边标签：折叠占位带数量，如「子工作项 · 3」 */
export function foldEdgeLabel(relationType: string, count: number): string {
  return `${relationLabel(relationType)} · ${count}`;
}

/**
 * 父 → 子关系类型。先找直连边，再经 relationHub 中转。
 * arrange / to-g6 共用，避免两套逻辑漂移。
 */
export function relationBetween(
  edges: readonly GraphEdge[],
  nodes: ReadonlyMap<string, GraphEntity>,
  parentId: string,
  childId: string,
): string {
  const direct = edges.find(
    (edge) =>
      (edge.source === parentId && edge.target === childId) ||
      (edge.target === parentId && edge.source === childId),
  );
  if (direct) {
    return direct.relationType;
  }
  for (const edge of edges) {
    const hubId =
      edge.source === parentId ? edge.target : edge.target === parentId ? edge.source : undefined;
    const hub = hubId ? nodes.get(hubId) : undefined;
    if (!hub?.relationHub) {
      continue;
    }
    const linked = edges.some(
      (item) =>
        (item.source === hubId && item.target === childId) ||
        (item.target === hubId && item.source === childId),
    );
    if (linked) {
      return hub.relationHub;
    }
  }
  return 'relate';
}

/** 负责人显示名 */
export function entityAssigneeName(item: GraphEntity | null | undefined): string {
  return item?.assignee?.display_name || item?.assignee?.name || '';
}

/** 是否可作为换根追溯的工作项卡片 */
export function isWorkItemEntity(item: GraphEntity): boolean {
  return item.navigationTarget === 'workitem' || item.id.startsWith('work_item:');
}

/** 打开详情用的导航目标；无效则返回 null */
export function resolveNavigationTarget(item: GraphEntity): NavigationTarget | null {
  const target = item.navigationTarget as NavigationTarget | undefined;
  if (target && Object.values(NavigationTarget).includes(target)) {
    return target;
  }
  return null;
}

const pivotOpeners: Partial<Record<NavigationTarget, (identifier: string) => Promise<void>>> = {
  [NavigationTarget.Workitem]: (identifier) => workitem.openDetail(identifier),
  [NavigationTarget.Idea]: (identifier) => idea.openDetail(identifier),
  [NavigationTarget.Testcase]: (identifier) => testcase.openDetail(identifier),
  [NavigationTarget.Ticket]: (identifier) => ticket.openDetail(identifier),
  [NavigationTarget.Page]: (identifier) => page.openDetail(identifier),
};

/** 通过 SDK 打开对应对象的 pivot 详情。identifier 为编号，如 GRA-3。 */
export function openPivot(item: GraphEntity): void {
  const identifier = item.identifier?.trim();
  if (!identifier) {
    return;
  }
  const open = pivotOpeners[resolveNavigationTarget(item) ?? NavigationTarget.Workitem];
  if (!open) {
    return;
  }
  void open(identifier).catch(() => undefined);
}

/** 按展示配置裁剪。开关关掉的关系隐藏，未列入配置的关系保留。 */
export function filterGraphByDisplaySettings(
  source: DependencyGraph,
  settings: readonly DisplaySetting[],
): DependencyGraph {
  const edges = source.edges.filter((edge) => isRelationShown(settings, edge.relationType));
  return keepEdgeNodes(source, edges);
}

function keepEdgeNodes(source: DependencyGraph, edges: DependencyGraph['edges']): DependencyGraph {
  const nodeIds = new Set<string>([source.rootId]);
  for (const edge of edges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  return {
    ...source,
    nodes: source.nodes.filter((node) => nodeIds.has(node.id)),
    edges,
  };
}
