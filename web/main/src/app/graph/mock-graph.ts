import type { DependencyGraph, GraphEdge, GraphEntity } from '../entities/graph.entity';
import { relationLabel } from '../utils/graph.util';

const SCOPE = {
  id: 'scope-demo',
  name: '客户门户',
  identifier: 'PORTAL',
};

function item(
  id: string,
  identifier: string,
  title: string,
  extra: Partial<GraphEntity>,
): GraphEntity {
  return {
    id,
    identifier,
    title,
    scope: SCOPE,
    navigationTarget: 'workitem',
    ...extra,
  };
}

const nodes: GraphEntity[] = [
  item('n-root', 'PORTAL-101', '完成登录模块重构', {
    type: { name: '用户故事' },
    state: { name: '开发中', type: 'in_progress' },
    priority: { name: '高' },
    assignee: { id: 'u1', display_name: '张三' },
  }),
  item('n-auth', 'PORTAL-88', '统一身份认证接入', {
    type: { name: '任务' },
    state: { name: '已完成', type: 'completed' },
    priority: { name: '高' },
    assignee: { id: 'u2', display_name: '李四' },
  }),
  item('n-ui', 'PORTAL-95', '登录页 UI 改版', {
    type: { name: '任务' },
    state: { name: '开发中', type: 'in_progress' },
    priority: { name: '中' },
    assignee: { id: 'u3', display_name: '王五' },
  }),
  item('n-api', 'PORTAL-97', '登录 API 兼容层', {
    type: { name: '任务' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '高' },
    assignee: { id: 'u1', display_name: '张三' },
  }),
  item('n-sso', 'PORTAL-72', 'SSO Token 刷新策略', {
    type: { name: '缺陷' },
    state: { name: '已完成', type: 'completed' },
    priority: { name: '紧急' },
    assignee: { id: 'u2', display_name: '李四' },
  }),
  item('n-mobile', 'PORTAL-110', '移动端登录适配', {
    type: { name: '用户故事' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '中' },
    assignee: { id: 'u4', display_name: '赵六' },
  }),
  item('n-audit', 'PORTAL-104', '登录审计日志', {
    type: { name: '任务' },
    state: { name: '开发中', type: 'in_progress' },
    priority: { name: '低' },
    assignee: { id: 'u3', display_name: '王五' },
  }),
  item('n-dup', 'PORTAL-99', '登录重构（旧需求）', {
    type: { name: '用户故事' },
    state: { name: '已关闭', type: 'closed' },
    priority: { name: '中' },
    assignee: { id: 'u1', display_name: '张三' },
  }),
  item('n-release', 'PORTAL-120', 'Q2 登录能力发布', {
    type: { name: '史诗' },
    state: { name: '规划中', type: 'pending' },
    priority: { name: '高' },
    assignee: { id: 'u5', display_name: '陈七' },
  }),
  item('n-perf', 'PORTAL-115', '登录接口性能优化', {
    type: { name: '任务' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '中' },
    assignee: { id: 'u2', display_name: '李四' },
  }),
  item('n-cache', 'PORTAL-130', '登录会话缓存策略', {
    type: { name: '任务' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '中' },
    assignee: { id: 'u2', display_name: '李四' },
  }),
  item('n-monitor', 'PORTAL-131', 'SSO 监控告警', {
    type: { name: '任务' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '低' },
    assignee: { id: 'u3', display_name: '王五' },
  }),
];

const edges: GraphEdge[] = (
  [
    ['e1', 'n-auth', 'n-root', 'block'],
    ['e2', 'n-api', 'n-root', 'block'],
    ['e3', 'n-sso', 'n-auth', 'block'],
    ['e4', 'n-root', 'n-mobile', 'block'],
    ['e5', 'n-root', 'n-release', 'block'],
    ['e6', 'n-ui', 'n-root', 'cause'],
    ['e7', 'n-root', 'n-audit', 'relate'],
    ['e8', 'n-root', 'n-dup', 'duplicate'],
    ['e9', 'n-api', 'n-perf', 'cause'],
    ['e10', 'n-mobile', 'n-release', 'block'],
    ['e11', 'n-perf', 'n-cache', 'relate'],
    ['e12', 'n-sso', 'n-monitor', 'relate'],
  ] as const
).map(([id, source, target, relationType]) => ({
  id,
  source,
  target,
  relationType,
  label: relationLabel(relationType),
}));

/** 全量模拟源图（含各跳数）；可见范围由前端 depth + 展开收起裁剪 */
export const MOCK_GRAPH: DependencyGraph = {
  rootId: 'n-root',
  depth: 3,
  nodes,
  edges,
  criticalPath: ['n-sso', 'n-auth', 'n-root', 'n-mobile', 'n-release'],
};
