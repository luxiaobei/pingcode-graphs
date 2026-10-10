import { idea, page, testcase, ticket, workitem } from '@pc-nexus/capabilities';
import { NavigationTarget } from '@pc-nexus/bridge';
import {
  CRITICAL_PATH_RELATION_TYPES,
  DEFAULT_EDGE_COLOR,
  RELATION_STYLE,
} from '../constants/graph.constants';
import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import type { RelationType } from '../enums/graph.enum';

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

/** 一批关系类型转成规范类型集合，用于筛选 */
export function toCanonicalTypes(types: RelationType[]): Set<string> {
  return new Set(types.map(toCanonicalType));
}

/** 是否参与关键路径高亮（默认 block） */
export function isCriticalRelation(type: RelationType): boolean {
  return CRITICAL_PATH_RELATION_TYPES.includes(toCanonicalType(type));
}

/** 节点类型名 */
export function entityTypeName(item: GraphEntity | null | undefined): string {
  if (!item?.type) {
    return '';
  }
  return typeof item.type === 'string' ? item.type : (item.type.name ?? '');
}

/** 负责人显示名 */
export function entityAssigneeName(item: GraphEntity | null | undefined): string {
  return item?.assignee?.display_name || item?.assignee?.name || '';
}

/** 所属范围名，优先 scope，否则 project */
export function entityScopeName(item: GraphEntity | null | undefined): string {
  return item?.scope?.name || item?.project?.name || '';
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

/** 按关系类型裁剪源图（真实接口也可在服务端过滤） */
export function filterGraphByRelations(
  source: DependencyGraph,
  relationTypes: RelationType[],
): DependencyGraph {
  const allowed = toCanonicalTypes(relationTypes);
  const edges = source.edges.filter((edge) => allowed.has(toCanonicalType(edge.relationType)));
  const nodeIds = new Set<string>([source.rootId]);
  for (const edge of edges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  return {
    ...source,
    nodes: source.nodes.filter((node) => nodeIds.has(node.id)),
    edges,
    criticalPath: source.criticalPath.filter((id) => nodeIds.has(id)),
  };
}
