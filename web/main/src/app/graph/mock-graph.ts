import { DependencyGraph, GraphEdge, GraphWorkItem, RelationType } from './graph.types';

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
  },
];

const edges: GraphEdge[] = [
  {
    id: 'e1',
    source: 'wi-auth',
    target: 'wi-root',
    relationType: 'block',
    label: '阻塞',
  },
  {
    id: 'e2',
    source: 'wi-api',
    target: 'wi-root',
    relationType: 'block',
    label: '阻塞',
  },
  {
    id: 'e3',
    source: 'wi-sso',
    target: 'wi-auth',
    relationType: 'block',
    label: '阻塞',
  },
  {
    id: 'e4',
    source: 'wi-root',
    target: 'wi-mobile',
    relationType: 'block',
    label: '阻塞',
  },
  {
    id: 'e5',
    source: 'wi-root',
    target: 'wi-release',
    relationType: 'block',
    label: '阻塞',
  },
  {
    id: 'e6',
    source: 'wi-ui',
    target: 'wi-root',
    relationType: 'cause',
    label: '导致',
  },
  {
    id: 'e7',
    source: 'wi-root',
    target: 'wi-audit',
    relationType: 'relate',
    label: '关联',
  },
  {
    id: 'e8',
    source: 'wi-root',
    target: 'wi-dup',
    relationType: 'duplicate',
    label: '重复',
  },
  {
    id: 'e9',
    source: 'wi-api',
    target: 'wi-perf',
    relationType: 'cause',
    label: '导致',
  },
  {
    id: 'e10',
    source: 'wi-mobile',
    target: 'wi-release',
    relationType: 'block',
    label: '阻塞',
  },
];

/** Full mock graph: root PORTAL-101 with a multi-level dependency neighborhood. */
export const MOCK_GRAPH: DependencyGraph = {
  rootId: 'wi-root',
  depth: 3,
  nodes,
  edges,
  criticalPath: ['wi-sso', 'wi-auth', 'wi-root', 'wi-mobile', 'wi-release'],
};

const NODE_DEPTH: Record<string, number> = {
  'wi-root': 0,
  'wi-auth': 1,
  'wi-ui': 1,
  'wi-api': 1,
  'wi-audit': 1,
  'wi-dup': 1,
  'wi-mobile': 1,
  'wi-release': 1,
  'wi-sso': 2,
  'wi-perf': 2,
};

export function buildMockGraph(
  depth: number,
  relationTypes: RelationType[],
): DependencyGraph {
  const allowed = new Set(relationTypes);
  const filteredEdges = MOCK_GRAPH.edges.filter((edge) => {
    if (!allowed.has(edge.relationType)) {
      return false;
    }
    const sourceDepth = NODE_DEPTH[edge.source] ?? depth;
    const targetDepth = NODE_DEPTH[edge.target] ?? depth;
    return sourceDepth <= depth && targetDepth <= depth;
  });

  const nodeIds = new Set<string>([MOCK_GRAPH.rootId]);
  for (const edge of filteredEdges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }

  const filteredNodes = MOCK_GRAPH.nodes.filter(
    (node) => nodeIds.has(node.id) && (NODE_DEPTH[node.id] ?? 0) <= depth,
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
