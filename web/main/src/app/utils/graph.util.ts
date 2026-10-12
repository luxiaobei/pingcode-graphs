import { idea, page, testcase, ticket, workitem } from '@pc-nexus/capabilities';
import { NavigationTarget } from '@pc-nexus/bridge';
import { DEFAULT_EDGE_COLOR, RELATION_STYLE } from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
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

/** 反向关系归到规范类型，如 blockedBy → block */
export function toCanonicalType(type: RelationType): string {
  return RELATION_STYLE[type]?.canonical ?? type;
}

/** 节点类型名 */
export function entityTypeName(item: GraphEntity | null | undefined): string {
  if (!item?.type) {
    return '';
  }
  return typeof item.type === 'string' ? item.type : (item.type.name ?? '');
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

/** 超长文案截断并加省略号 */
export function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

/** 按展示配置裁剪。开关关掉的关系隐藏，未列入配置的关系保留。 */
export function filterGraphByDisplaySettings(
  source: DependencyGraph,
  settings: readonly DisplaySetting[],
): DependencyGraph {
  const edges = source.edges.filter((edge) =>
    isRelationShown(settings, toCanonicalType(edge.relationType)),
  );
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
