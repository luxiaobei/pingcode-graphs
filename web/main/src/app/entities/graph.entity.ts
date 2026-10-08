import type { GraphNodeKind, RelationType } from '../enums/graph.enum';

export interface GraphWorkItem {
  id: string;
  identifier?: string;
  title?: string;
  type?: string | { id?: string; name?: string };
  state?: {
    id?: string;
    name?: string;
    type?: string;
  };
  project?: {
    id?: string;
    name?: string;
    identifier?: string;
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
  /** 相对根节点的跳数（0 = 当前焦点） */
  depth?: number;
  /** 节点种类：工作项 / 展开占位（more） */
  kind?: GraphNodeKind;
  /** 尚未展开的邻居数量，用于渲染「N more」 */
  hiddenNeighborCount?: number;
  /** 拖拽后固定的画布坐标（前端写入） */
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
  nodes: GraphWorkItem[];
  edges: GraphEdge[];
  criticalPath: string[];
}

export interface GetDependencyGraphPayload {
  workitemId?: string;
  depth?: number;
  relationTypes?: RelationType[];
}

export interface RelationStyle {
  label: string;
  color: string;
  /** 反向关系映射到规范边类型，如 blockedBy → block */
  canonical?: string;
}
