import type { GraphNodeKind, RelationType } from '../enums/graph.enum';

/** 所属范围（项目 / 空间 / 测试库等，由服务端按安装应用填充） */
export interface GraphScope {
  id?: string;
  name?: string;
  identifier?: string;
}

/** 关系图业务节点；各应用安装后由服务端统一映射到此结构 */
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
  scope?: GraphScope;
  /** 打开详情的导航目标，由服务端下发（如 workitem / testcase / ticket） */
  navigationTarget?: string;
  /** 相对根节点的跳数（0 = 当前焦点） */
  depth?: number;
  /** 节点种类：业务实体 / 展开占位（more） */
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
  nodes: GraphEntity[];
  edges: GraphEdge[];
  criticalPath: string[];
}

export interface GetDependencyGraphPayload {
  entityId?: string;
  depth?: number;
  relationTypes?: RelationType[];
}

export interface RelationStyle {
  label: string;
  color: string;
  /** 反向关系映射到规范边类型，如 blockedBy → block */
  canonical?: string;
}
