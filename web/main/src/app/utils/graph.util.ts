import { idea, page, testcase, ticket, workitem } from '@pc-nexus/capabilities';
import { NavigationTarget } from '@pc-nexus/bridge';
import { RELATION_STYLE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';
import type { RelationType } from '../enums/graph.enum';
import { isRelationShown, type DisplaySetting } from '../settings/display-settings';

/** 关系展示名（阻塞、关联等） */
export function relationLabel(type: RelationType, fallback?: string): string {
  return RELATION_STYLE[type]?.label ?? fallback ?? type;
}

/** 展开收起 / 分叉 key：`父节点::关系类型` */
export function relationFoldKey(parentId: string, relationType: string): string {
  return `${parentId}::${relationType}`;
}

/** 同侧「关联/阻塞/重复等」整体收起（不含父/子） */
export const BUNDLE_FOLD_TYPE = 'bundle';

export function relationBundleFoldKey(parentId: string): string {
  return relationFoldKey(parentId, BUNDLE_FOLD_TYPE);
}

/** 走公共脊的其它关系（非父、非子、非整体收起占位） */
export function isBundleRelationType(type: string): boolean {
  return type !== 'parent' && type !== 'child' && type !== BUNDLE_FOLD_TYPE;
}

/** 折叠占位节点 id */
export function foldSummaryNodeId(foldKey: string): string {
  return `fold:${foldKey}`;
}

export function isFoldSummaryId(id: string): boolean {
  return id.startsWith('fold:');
}

/** 是否为折叠「+ N」占位 */
export function isFoldSummaryNode(node: GraphEntity | null | undefined): boolean {
  return Boolean(node?.foldSummary);
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

/**
 * 同一锚点下、指定关系类型的节点（含折叠占位，除非 excludeFoldSummary）。
 * 布局重锚 / 收起对齐共用，避免多处手写 filter 漂移。
 */
export function siblingsOfRelation(
  graph: DependencyGraph,
  parentId: string,
  relationType: string,
  options?: { excludeFoldSummary?: boolean },
): GraphEntity[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const excludeFold = options?.excludeFoldSummary === true;
  return graph.nodes.filter((item) => {
    if (item.relationHub || item.revealedByAnchorId !== parentId) {
      return false;
    }
    if (excludeFold && isFoldSummaryNode(item)) {
      return false;
    }
    const type =
      item.foldSummary?.relationType ?? relationBetween(graph.edges, nodes, parentId, item.id);
    return type === relationType;
  });
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

/** 通过 SDK 打开详情。工作项等传编号（如 GRA-3），测试用例传用例 id。 */
export function openPivot(item: GraphEntity): void {
  const target = resolveNavigationTarget(item) ?? NavigationTarget.Workitem;
  const identifier = pivotIdentifier(item, target);
  if (!identifier) {
    return;
  }
  const open = pivotOpeners[target];
  if (!open) {
    return;
  }
  void open(identifier).catch(() => undefined);
}

function pivotIdentifier(item: GraphEntity, target: NavigationTarget): string {
  if (target === NavigationTarget.Testcase) {
    return testCaseId(item);
  }
  return typeof item.identifier === 'string' ? item.identifier.trim() : '';
}

/** 节点 id 为 test_case:{用例 id}；同一对象多次出现时 id 会带前缀，取最后一段。 */
function testCaseId(item: GraphEntity): string {
  const marker = 'test_case:';
  const index = item.id.lastIndexOf(marker);
  if (index < 0) {
    return '';
  }
  return item.id.slice(index + marker.length).trim();
}

/** 按展示配置裁掉关系线，以及只靠这些线连上的卡片。未列入配置的关系保留。 */
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
