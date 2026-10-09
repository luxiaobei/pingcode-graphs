import type { DependencyGraph, GetDependencyGraphPayload } from '../entities/graph.entity';
import { MOCK_GRAPH } from '../graph/mock-graph';

/**
 * 拉取关系图源数据。
 * 当前走模拟数据；接入真实接口时改为 invoke('getDependencyGraph', payload)。
 * 建议请求最大 depth（3），工具栏深度与展开收起由前端裁剪。
 */
export const USING_MOCK_GRAPH = true;

export async function getDependencyGraph(
  _payload: GetDependencyGraphPayload = {},
): Promise<DependencyGraph> {
  return structuredClone(MOCK_GRAPH);
}
