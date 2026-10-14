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
  item('n-clone', 'PORTAL-116', '登录模块重构（拷贝）', {
    type: { name: '用户故事' },
    state: { name: '待处理', type: 'pending' },
    priority: { name: '中' },
    assignee: { id: 'u1', display_name: '张三' },
  }),
  item('n-origin', 'PORTAL-80', '登录模块初版', {
    type: { name: '用户故事' },
    state: { name: '已关闭', type: 'closed' },
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
  item('n-idea', 'IDEA-12', '登录体验改版', {
    type: { name: '产品需求' },
    navigationTarget: 'idea',
    assignee: { id: 'u4', display_name: '赵六' },
  }),
  item('n-idea-2', 'IDEA-18', '多因子登录', {
    type: { name: '产品需求' },
    navigationTarget: 'idea',
    assignee: { id: 'u5', display_name: '陈七' },
  }),
  item('n-ticket', 'TCK-7', '无法收到验证码', {
    type: { name: '工单' },
    navigationTarget: 'ticket',
    assignee: { id: 'u2', display_name: '李四' },
  }),
  item('n-objective', 'OBJ-3', '登录成功率 99.9%', {
    type: { name: '目标' },
    navigationTarget: 'workitem',
    assignee: { id: 'u5', display_name: '陈七' },
  }),
  item('n-objective-2', 'OBJ-8', '登录耗时低于 1 秒', {
    type: { name: '目标' },
    navigationTarget: 'workitem',
    assignee: { id: 'u1', display_name: '张三' },
  }),
  item('n-objective-3', 'OBJ-11', '账号投诉下降 30%', {
    type: { name: '目标' },
    navigationTarget: 'workitem',
    assignee: { id: 'u4', display_name: '赵六' },
  }),
  item('n-test', 'TC-21', '登录主流程', {
    type: { name: '测试用例' },
    navigationTarget: 'testcase',
    assignee: { id: 'u3', display_name: '王五' },
  }),
  item('n-depend', 'PORTAL-140', '账号服务可用', {
    type: { name: '任务' },
    assignee: { id: 'u1', display_name: '张三' },
  }),
  item('n-parent', 'PORTAL-80', '客户门户登录能力', {
    type: { name: '史诗' },
    assignee: { id: 'u5', display_name: '陈七' },
  }),
  item('n-c1', 'PORTAL-150', '拆分登录子任务', {
    type: { name: '任务' },
    assignee: { id: 'u2', display_name: '李四' },
  }),
  item('n-c1b', 'PORTAL-151', '补齐错误提示', {
    type: { name: '任务' },
    assignee: { id: 'u3', display_name: '王五' },
  }),
  item('n-c1c', 'PORTAL-159', '整理登录文档', {
    type: { name: '任务' },
    assignee: { id: 'u5', display_name: '陈七' },
  }),
  item('n-c2', 'PORTAL-152', '登录表单', {
    type: { name: '任务' },
    assignee: { id: 'u2', display_name: '李四' },
  }),
  item('n-c2b', 'PORTAL-153', '验证码流程', {
    type: { name: '任务' },
    assignee: { id: 'u4', display_name: '赵六' },
  }),
  item('n-c3', 'PORTAL-154', '账号输入', {
    type: { name: '任务' },
    assignee: { id: 'u1', display_name: '张三' },
  }),
  item('n-c3b', 'PORTAL-155', '密码校验', {
    type: { name: '任务' },
    assignee: { id: 'u3', display_name: '王五' },
  }),
  item('n-c4', 'PORTAL-156', '记住账号', {
    type: { name: '任务' },
    assignee: { id: 'u2', display_name: '李四' },
  }),
  item('n-c4b', 'PORTAL-157', '自动填充', {
    type: { name: '任务' },
    assignee: { id: 'u5', display_name: '陈七' },
  }),
  item('n-c5', 'PORTAL-158', '本地缓存账号', {
    type: { name: '任务' },
    assignee: { id: 'u1', display_name: '张三' },
  }),
];

const edges: GraphEdge[] = (
  [
    ['e1', 'n-root', 'n-auth', 'blockedBy'],
    ['e2', 'n-root', 'n-api', 'blockedBy'],
    ['e3', 'n-root', 'n-sso', 'blockedBy'],
    ['e4', 'n-root', 'n-mobile', 'block'],
    ['e5', 'n-root', 'n-release', 'block'],
    ['e6', 'n-root', 'n-ui', 'causedBy'],
    ['e7', 'n-root', 'n-audit', 'relate'],
    ['e8', 'n-root', 'n-dup', 'duplicate'],
    ['e9', 'n-root', 'n-perf', 'cause'],
    ['e9b', 'n-root', 'n-clone', 'clone'],
    ['e9c', 'n-root', 'n-origin', 'clonedBy'],
    ['e11', 'n-root', 'n-cache', 'relate'],
    ['e12', 'n-root', 'n-monitor', 'relate'],
    ['e13', 'n-root', 'n-idea', 'relate:idea'],
    ['e14', 'n-root', 'n-idea-2', 'relate:idea'],
    ['e15', 'n-root', 'n-ticket', 'relate:ticket'],
    ['e16', 'n-root', 'n-objective', 'relate:objective'],
    ['e16b', 'n-root', 'n-objective-2', 'relate:objective'],
    ['e16c', 'n-root', 'n-objective-3', 'relate:objective'],
    ['e17', 'n-root', 'n-test', 'relate:test_case'],
    ['e18', 'n-root', 'n-depend', 'depend'],
    ['e18b', 'n-root', 'n-parent', 'parent'],
    ['e19', 'n-root', 'n-c1', 'child'],
    ['e20', 'n-root', 'n-c1b', 'child'],
    ['e20b', 'n-root', 'n-c1c', 'child'],
    ['e21', 'n-c1', 'n-c2', 'child'],
    ['e22', 'n-c1', 'n-c2b', 'child'],
    ['e23', 'n-c2', 'n-c3', 'child'],
    ['e24', 'n-c2', 'n-c3b', 'child'],
    ['e25', 'n-c3', 'n-c4', 'child'],
    ['e26', 'n-c3', 'n-c4b', 'child'],
    ['e27', 'n-c4', 'n-c5', 'child'],
  ] as const
).map(([id, source, target, relationType]) => ({
  id,
  source,
  target,
  relationType,
  label: relationLabel(relationType),
}));

/** 模拟源图。子工作项最多 5 层，其他关系只挂在根上。 */
export const MOCK_GRAPH: DependencyGraph = {
  rootId: 'n-root',
  depth: 5,
  nodes,
  edges,
};

/** 用模拟图里的某个工作项当中心。不在图里时仍用原来的根。 */
export function mockGraphFrom(rootId?: string | null): DependencyGraph {
  const graph = structuredClone(MOCK_GRAPH);
  if (rootId && graph.nodes.some((node) => node.id === rootId && !node.relationHub)) {
    graph.rootId = rootId;
  }
  return graph;
}
