import { invoke, view } from '@pc-nexus/bridge';
import type { DependencyGraph, GetDependencyGraphPayload } from '../entities/graph.entity';
import {
  toDependencyGraph,
  type KgDeepRelationResult,
  type KgEdgeRecord,
  type KgReachedNode,
} from '../utils/to-dependency-graph';

/** 与后端 getDeepRelation 的 payload 对齐。 */
interface GetDeepRelationPayload {
  nodeId: string;
  type: string[];
  depth: number;
  direction?: 'outgoing' | 'incoming' | 'both';
}

/** 出边类型。parent_of 在 toEdge 里按方向拆成父/子。 */
const OUTGOING_EDGE_TYPES = [
  'blocks',
  'blocked_by',
  'causes',
  'caused_by',
  'clones',
  'cloned_by',
  'duplicates',
  'mentions',
  'relates',
  'parent_of',
] as const;

/** 关联 / 父项：只取直接出边。 */
const RELATION_DEPTH = 1;

/** 子项：沿 parent_of 入边展开。 */
const CHILD_DEPTH = 5;

/** 按当前工作项拉取真实关系图。 */
export async function getDependencyGraph(
  payload: GetDependencyGraphPayload = {},
): Promise<DependencyGraph> {
  const context = await view.getContext<{ workitem?: { id?: string } }>();
  const workitemId = payload.workitemId || context.extension?.data?.workitem?.id;
  if (!workitemId) {
    throw new Error('缺少当前工作项，无法加载关系图');
  }
  const nodeId = workitemId.includes(':') ? workitemId : `work_item:${workitemId}`;
  const [relations, children] = await Promise.all([
    fetchRelation(nodeId, [...OUTGOING_EDGE_TYPES], RELATION_DEPTH, 'outgoing'),
    fetchRelation(nodeId, ['parent_of'], CHILD_DEPTH, 'incoming'),
  ]);
  return toDependencyGraph(nodeId, CHILD_DEPTH, mergeResults(relations, children));
}

function fetchRelation(
  nodeId: string,
  type: string[],
  depth: number,
  direction: GetDeepRelationPayload['direction'],
): Promise<KgDeepRelationResult> {
  return invoke<GetDeepRelationPayload, KgDeepRelationResult>('getDeepRelation', {
    nodeId,
    type,
    depth,
    direction,
  });
}

function mergeResults(...results: KgDeepRelationResult[]): KgDeepRelationResult {
  const nodes = new Map<string, KgReachedNode>();
  const edges = new Map<string, KgEdgeRecord>();
  for (const result of results) {
    for (const reached of result.nodes ?? []) {
      const id = reached.node?.id;
      if (!id) {
        continue;
      }
      const existing = nodes.get(id);
      if (!existing || (reached.depth ?? 0) < (existing.depth ?? 0)) {
        nodes.set(id, reached);
      }
    }
    for (const edge of result.edges ?? []) {
      if (edge.id) {
        edges.set(edge.id, edge);
      }
    }
  }
  return {
    rootId: results[0]?.rootId ?? '',
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}
