import type { DependencyGraph, GraphEntity } from '../entities/graph.entity';
import { isAssocBundleRelation, type Side } from './arrange-graph';
import {
  BUNDLE_FOLD_TYPE,
  isFoldSummaryNode,
  relationBetween,
  siblingsOfRelation,
} from './graph.util';
import type { GraphNodePosition } from './to-g6-data';

/**
 * 折叠占位对应的子卡。
 * 「关联」整体（relationType=bundle）要匹配所有可并入干的类型，不能只找 type===bundle。
 */
function siblingsForFold(
  graph: DependencyGraph,
  parentId: string,
  relationType: string,
  options?: { excludeFoldSummary?: boolean },
): GraphEntity[] {
  if (relationType !== BUNDLE_FOLD_TYPE) {
    return siblingsOfRelation(graph, parentId, relationType, options);
  }
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
    return isAssocBundleRelation(type);
  });
}

interface ReanchorCluster {
  ids: Set<string>;
  side: Side;
  anchor: { x: number; y: number };
}

/**
 * 收起时落位 +N：与普通卡同一套 pin 规则。
 * - 有 fold pin（含展开期间 keepHidden 留下的）：直接用，并写回 relationSides
 * - 无 pin：对齐到该关系展开子卡中心（仅默认初值）
 */
export function placeFoldsAtExpandedSlots(
  data: DependencyGraph,
  prev: DependencyGraph | null,
  pins: ReadonlyMap<string, GraphNodePosition>,
  layout: Map<string, GraphNodePosition>,
  foldPins: ReadonlyMap<string, GraphNodePosition>,
  relationSides: Map<string, Side>,
): void {
  for (const node of data.nodes) {
    if (!isFoldSummaryNode(node)) {
      continue;
    }
    const kept = foldPins.get(node.id) ?? pins.get(node.id);
    if (kept && Number.isFinite(kept.x) && Number.isFinite(kept.y)) {
      const base = layout.get(node.id);
      layout.set(node.id, {
        ...(base ?? kept),
        x: kept.x,
        y: kept.y,
        side: kept.side ?? base?.side,
      });
      if (kept.side && node.foldSummary) {
        relationSides.set(node.foldSummary.relationType, kept.side);
      }
      continue;
    }
    if (!prev) {
      continue;
    }
    const fold = node.foldSummary;
    const parentId = node.revealedByAnchorId;
    if (!fold || !parentId) {
      continue;
    }
    const kids = siblingsForFold(prev, parentId, fold.relationType, {
      excludeFoldSummary: true,
    });
    const points = kids
      .map((child) => pins.get(child.id))
      .filter((pos): pos is GraphNodePosition => Boolean(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)));
    if (!points.length) {
      continue;
    }
    const x = points.reduce((sum, pos) => sum + pos.x, 0) / points.length;
    const y = points.reduce((sum, pos) => sum + pos.y, 0) / points.length;
    const base = layout.get(node.id);
    const side =
      points.find((pos) => pos.side)?.side ??
      relationSides.get(fold.relationType) ??
      base?.side;
    layout.set(node.id, { ...(base ?? { x, y }), x, y, side });
  }
}

/** 收起占位上的 side 写入关系偏好，供 arrange 排到对应侧、展开后跟最新方位。 */
export function syncRelationSidesFromFolds(
  prev: DependencyGraph | null,
  foldPins: ReadonlyMap<string, GraphNodePosition>,
  relationSides: Map<string, Side>,
): void {
  if (!prev) {
    return;
  }
  for (const node of prev.nodes) {
    if (!isFoldSummaryNode(node) || !node.foldSummary) {
      continue;
    }
    const pin = foldPins.get(node.id);
    if (pin?.side) {
      relationSides.set(node.foldSummary.relationType, pin.side);
    }
  }
}

/**
 * 折叠占位拖到新方位后展开：清掉仍停在旧侧的子树 pin，强制按新侧重排。
 */
export function clearStalePinsAfterFoldDrag(
  data: DependencyGraph,
  prev: DependencyGraph | null,
  foldPins: ReadonlyMap<string, GraphNodePosition>,
  pins: Map<string, GraphNodePosition>,
): ReanchorCluster[] {
  if (!prev) {
    return [];
  }
  const dataNodes = new Set(data.nodes.map((node) => node.id));
  const childrenOf = new Map<string, string[]>();
  for (const node of data.nodes) {
    if (node.relationHub || !node.revealedByAnchorId) {
      continue;
    }
    const list = childrenOf.get(node.revealedByAnchorId) ?? [];
    list.push(node.id);
    childrenOf.set(node.revealedByAnchorId, list);
  }

  const clusters: ReanchorCluster[] = [];
  for (const node of prev.nodes) {
    if (!isFoldSummaryNode(node) || !node.foldSummary || !node.revealedByAnchorId) {
      continue;
    }
    if (dataNodes.has(node.id)) {
      continue;
    }
    const foldPin = foldPins.get(node.id);
    if (!foldPin?.side) {
      continue;
    }
    const parentId = node.revealedByAnchorId;
    const parentPin = pins.get(parentId);
    if (!parentPin) {
      continue;
    }
    const relationType = node.foldSummary.relationType;
    const clusterIds = new Set<string>();
    for (const child of siblingsForFold(data, parentId, relationType, {
      excludeFoldSummary: true,
    })) {
      const childPin = pins.get(child.id);
      // 只比声明 side，不用几何投票（宽排会误判）
      if (childPin?.side === foldPin.side) {
        continue;
      }
      const queue = [child.id];
      while (queue.length) {
        const id = queue.shift()!;
        pins.delete(id);
        clusterIds.add(id);
        queue.push(...(childrenOf.get(id) ?? []));
      }
    }
    if (clusterIds.size) {
      clusters.push({
        ids: clusterIds,
        side: foldPin.side,
        anchor: { x: foldPin.x, y: foldPin.y },
      });
    }
  }
  return clusters;
}
