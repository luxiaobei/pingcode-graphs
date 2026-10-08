import type { DependencyGraph, GraphEdge, GraphWorkItem } from '../entities/graph.entity';
import type { RelationType } from '../enums/graph.enum';
import { relationLabel, toCanonicalTypes } from '../utils/graph.util';

const PROJECT = {
  id: 'proj-demo',
  name: '客户门户',
  identifier: 'PORTAL',
};

const nodes: GraphWorkItem[] = [
  {
    id: 'wi-root',
    identifier: 'PORTAL-101',
    title: '完成登录模块重构',
    type: { name: '用户故事' },
    state: { name: '开发中', type: 'in_progress' },
    priority: { name: '高' },
    assignee: { id: 'u1', display_name: '张三' },
    project: PROJECT,
    depth: 0,
  },
  {
    id: 'wi-auth',
    identifier: 'PORTAL-88',
    title: '统一身份认证接入',
    type: { name: '任务' },
    state: { name: '已完成', type: 'completed' },
    priority: { name: '高' },
    assignee: { id: 'u2', display_name: '李四' },
    project: PROJECT,
    depth: 1,
  },
  {
    id: 'wi-ui',
    identifier: 'PORTAL-95',
    title: '登录页 UI 改版',
    type: { name: '任务' },
    state: { name: '开发中', type: 'in_progress' },
    priority: { name: '中' },
    assignee: { id: 'u3', display_name: '王五' },
    project: PROJECT,
    depth: 1,
  },
  {
    id: 'wi-api',
    identifier: 'PORTAL-97',
    title: '登录 API 兼容层',
    type: { name: '任务' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '高' },
    assignee: { id: 'u1', display_name: '张三' },
    project: PROJECT,
    depth: 1,
  },
  {
    id: 'wi-sso',
    identifier: 'PORTAL-72',
    title: 'SSO Token 刷新策略',
    type: { name: '缺陷' },
    state: { name: '已完成', type: 'completed' },
    priority: { name: '紧急' },
    assignee: { id: 'u2', display_name: '李四' },
    project: PROJECT,
    depth: 2,
  },
  {
    id: 'wi-mobile',
    identifier: 'PORTAL-110',
    title: '移动端登录适配',
    type: { name: '用户故事' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '中' },
    assignee: { id: 'u4', display_name: '赵六' },
    project: PROJECT,
    depth: 1,
  },
  {
    id: 'wi-audit',
    identifier: 'PORTAL-104',
    title: '登录审计日志',
    type: { name: '任务' },
    state: { name: '开发中', type: 'in_progress' },
    priority: { name: '低' },
    assignee: { id: 'u3', display_name: '王五' },
    project: PROJECT,
    depth: 1,
  },
  {
    id: 'wi-dup',
    identifier: 'PORTAL-99',
    title: '登录重构（旧需求）',
    type: { name: '用户故事' },
    state: { name: '已关闭', type: 'closed' },
    priority: { name: '中' },
    assignee: { id: 'u1', display_name: '张三' },
    project: PROJECT,
    depth: 1,
  },
  {
    id: 'wi-release',
    identifier: 'PORTAL-120',
    title: 'Q2 登录能力发布',
    type: { name: '史诗' },
    state: { name: '规划中', type: 'pending' },
    priority: { name: '高' },
    assignee: { id: 'u5', display_name: '陈七' },
    project: PROJECT,
    depth: 1,
  },
  {
    id: 'wi-perf',
    identifier: 'PORTAL-115',
    title: '登录接口性能优化',
    type: { name: '任务' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '中' },
    assignee: { id: 'u2', display_name: '李四' },
    project: PROJECT,
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
  edge('e1', 'wi-auth', 'wi-root', 'block'),
  edge('e2', 'wi-api', 'wi-root', 'block'),
  edge('e3', 'wi-sso', 'wi-auth', 'block'),
  edge('e4', 'wi-root', 'wi-mobile', 'block'),
  edge('e5', 'wi-root', 'wi-release', 'block'),
  edge('e6', 'wi-ui', 'wi-root', 'cause'),
  edge('e7', 'wi-root', 'wi-audit', 'relate'),
  edge('e8', 'wi-root', 'wi-dup', 'duplicate'),
  edge('e9', 'wi-api', 'wi-perf', 'cause'),
  edge('e10', 'wi-mobile', 'wi-release', 'block'),
];

export const MOCK_GRAPH: DependencyGraph = {
  rootId: 'wi-root',
  depth: 3,
  nodes,
  edges,
  criticalPath: ['wi-sso', 'wi-auth', 'wi-root', 'wi-mobile', 'wi-release'],
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
