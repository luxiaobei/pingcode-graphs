import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';
import type { RelationType } from '../enums/graph.enum';
import { relationLabel, toCanonicalTypes } from '../utils/graph.util';

const SCOPE = {
  id: 'scope-demo',
  name: '客户门户',
  identifier: 'PORTAL',
};

const nodes: GraphEntity[] = [
  {
    id: 'n-root',
    identifier: 'PORTAL-101',
    title: '完成登录模块重构',
    type: { name: '用户故事' },
    state: { name: '开发中', type: 'in_progress' },
    priority: { name: '高' },
    assignee: { id: 'u1', display_name: '张三' },
    scope: SCOPE,
    navigationTarget: 'workitem',
    depth: 0,
  },
  {
    id: 'n-auth',
    identifier: 'PORTAL-88',
    title: '统一身份认证接入',
    type: { name: '任务' },
    state: { name: '已完成', type: 'completed' },
    priority: { name: '高' },
    assignee: { id: 'u2', display_name: '李四' },
    scope: SCOPE,
    navigationTarget: 'workitem',
    depth: 1,
  },
  {
    id: 'n-ui',
    identifier: 'PORTAL-95',
    title: '登录页 UI 改版',
    type: { name: '任务' },
    state: { name: '开发中', type: 'in_progress' },
    priority: { name: '中' },
    assignee: { id: 'u3', display_name: '王五' },
    scope: SCOPE,
    navigationTarget: 'workitem',
    depth: 1,
  },
  {
    id: 'n-api',
    identifier: 'PORTAL-97',
    title: '登录 API 兼容层',
    type: { name: '任务' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '高' },
    assignee: { id: 'u1', display_name: '张三' },
    scope: SCOPE,
    navigationTarget: 'workitem',
    depth: 1,
  },
  {
    id: 'n-sso',
    identifier: 'PORTAL-72',
    title: 'SSO Token 刷新策略',
    type: { name: '缺陷' },
    state: { name: '已完成', type: 'completed' },
    priority: { name: '紧急' },
    assignee: { id: 'u2', display_name: '李四' },
    scope: SCOPE,
    navigationTarget: 'workitem',
    depth: 2,
  },
  {
    id: 'n-mobile',
    identifier: 'PORTAL-110',
    title: '移动端登录适配',
    type: { name: '用户故事' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '中' },
    assignee: { id: 'u4', display_name: '赵六' },
    scope: SCOPE,
    navigationTarget: 'workitem',
    depth: 1,
  },
  {
    id: 'n-audit',
    identifier: 'PORTAL-104',
    title: '登录审计日志',
    type: { name: '任务' },
    state: { name: '开发中', type: 'in_progress' },
    priority: { name: '低' },
    assignee: { id: 'u3', display_name: '王五' },
    scope: SCOPE,
    navigationTarget: 'workitem',
    depth: 1,
  },
  {
    id: 'n-dup',
    identifier: 'PORTAL-99',
    title: '登录重构（旧需求）',
    type: { name: '用户故事' },
    state: { name: '已关闭', type: 'closed' },
    priority: { name: '中' },
    assignee: { id: 'u1', display_name: '张三' },
    scope: SCOPE,
    navigationTarget: 'workitem',
    depth: 1,
  },
  {
    id: 'n-release',
    identifier: 'PORTAL-120',
    title: 'Q2 登录能力发布',
    type: { name: '史诗' },
    state: { name: '规划中', type: 'pending' },
    priority: { name: '高' },
    assignee: { id: 'u5', display_name: '陈七' },
    scope: SCOPE,
    navigationTarget: 'workitem',
    depth: 1,
  },
  {
    id: 'n-perf',
    identifier: 'PORTAL-115',
    title: '登录接口性能优化',
    type: { name: '任务' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '中' },
    assignee: { id: 'u2', display_name: '李四' },
    scope: SCOPE,
    navigationTarget: 'workitem',
    depth: 2,
  },
];

function edge(
  id: string,
  source: string,
  target: string,
  relationType: RelationType,
): GraphEdge {
  return {
    id,
    source,
    target,
    relationType,
    label: relationLabel(relationType),
  };
}

const edges: GraphEdge[] = [
  edge('e1', 'n-auth', 'n-root', 'block'),
  edge('e2', 'n-api', 'n-root', 'block'),
  edge('e3', 'n-sso', 'n-auth', 'block'),
  edge('e4', 'n-root', 'n-mobile', 'block'),
  edge('e5', 'n-root', 'n-release', 'block'),
  edge('e6', 'n-ui', 'n-root', 'cause'),
  edge('e7', 'n-root', 'n-audit', 'relate'),
  edge('e8', 'n-root', 'n-dup', 'duplicate'),
  edge('e9', 'n-api', 'n-perf', 'cause'),
  edge('e10', 'n-mobile', 'n-release', 'block'),
];

export const MOCK_GRAPH: DependencyGraph = {
  rootId: 'n-root',
  depth: 3,
  nodes,
  edges,
  criticalPath: ['n-sso', 'n-auth', 'n-root', 'n-mobile', 'n-release'],
};

export function buildMockGraph(
  depth: number,
  relationTypes: RelationType[],
): DependencyGraph {
  const allowed = toCanonicalTypes(relationTypes);
  const depthById = new Map(nodes.map((node) => [node.id, node.depth ?? 0]));

  const filteredEdges = edges.filter((item) => {
    if (!allowed.has(item.relationType)) {
      return false;
    }
    return (depthById.get(item.source) ?? 0) <= depth && (depthById.get(item.target) ?? 0) <= depth;
  });

  const nodeIds = new Set<string>([MOCK_GRAPH.rootId]);
  for (const item of filteredEdges) {
    nodeIds.add(item.source);
    nodeIds.add(item.target);
  }

  const filteredNodes = nodes.filter(
    (node) => nodeIds.has(node.id) && (node.depth ?? 0) <= depth,
  );
  const criticalPath = MOCK_GRAPH.criticalPath.filter((id) => nodeIds.has(id));

  return {
    rootId: MOCK_GRAPH.rootId,
    depth,
    nodes: filteredNodes,
    edges: filteredEdges,
    criticalPath: criticalPath.length ? criticalPath : [MOCK_GRAPH.rootId],
  };
}
