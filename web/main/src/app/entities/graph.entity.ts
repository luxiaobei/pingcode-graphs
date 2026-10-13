import type { RelationType } from '../enums/graph.enum';

/** 所属范围（项目 / 空间 / 测试库等） */
export interface GraphScope {
  id?: string;
  name?: string;
  identifier?: string;
}

/**
 * 关系图节点。
 * 服务端字段与 GraphWorkItem 对齐；depth / folds 等由前端计算。
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
    avatar?: string;
  };
  /** thy-icon 名称，来自 type_icon */
  icon?: string;
  /** thy-icon 颜色，来自 type_color */
  iconColor?: string;
  /** 服务端常用字段 */
  project?: GraphScope;
  /** 前端展示用，缺省时回退 project */
  scope?: GraphScope;
  /** 打开详情的导航目标（如 workitem / testcase / ticket） */
  navigationTarget?: string;
  /** 关系聚合节点。有值时这一节点代表一种关系，具体对象挂在它下面。 */
  relationHub?: string;
  /** 相对根节点跳数（0 = 焦点），前端 BFS 计算 */
  depth?: number;
  /** 展开树上的父节点 */
  revealedByAnchorId?: string;
  position?: { x: number; y: number };
  /** 从这张卡片出发的关系，每种一个展开收起 */
  folds?: RelationFold[];
}

/** 一种关系的展开收起。key 是「父节点::关系类型」。 */
export interface RelationFold {
  key: string;
  relationType: string;
  count: number;
  expanded: boolean;
}

/** 画在关系线起点上的展开收起 */
export interface FoldMark {
  key: string;
  text: string;
  left: number;
  top: number;
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
