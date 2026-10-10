import type { RelationType } from '../enums/graph.enum';

/** 所属范围（项目 / 空间 / 测试库等） */
export interface GraphScope {
  id?: string;
  name?: string;
  identifier?: string;
}

/**
 * 关系图节点。
 * 服务端字段与 GraphWorkItem 对齐；depth / expandToggle 等由前端计算。
 */
export interface GraphEntity {
  id: string;
  identifier?: string;
  title?: string;
  type?: string | { id?: string; name?: string };
  state?: {
    id?: string;
    name?: string;
    type?: string;
  };
  priority?: {
    id?: string;
    name?: string;
  };
  assignee?: {
    id?: string;
    name?: string;
    display_name?: string;
  };
  /** 服务端常用字段 */
  project?: GraphScope;
  /** 前端展示用，缺省时回退 project */
  scope?: GraphScope;
  /** 打开详情的导航目标（如 workitem / testcase / ticket） */
  navigationTarget?: string;
  /** 相对根节点跳数（0 = 焦点），前端 BFS 计算 */
  depth?: number;
  /** 卡片 +/-：有向外子树时出现 */
  expandToggle?: 'collapsed' | 'expanded';
  /** 展开树上的父节点 */
  revealedByAnchorId?: string;
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationType: RelationType;
  label: string;
}

export interface DependencyGraph {
  rootId: string;
  depth: number;
  nodes: GraphEntity[];
  edges: GraphEdge[];
  criticalPath: string[];
}

/** 与后端 getDependencyGraph 对齐 */
export interface GetDependencyGraphPayload {
  workitemId?: string;
  depth?: number;
  relationTypes?: RelationType[];
}

export interface RelationStyle {
  label: string;
  color: string;
  canonical?: string;
}
