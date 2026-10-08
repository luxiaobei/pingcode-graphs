export type RelationType = string;

export const KNOWN_RELATION_TYPES = [
    "block",
    "blockedBy",
    "cause",
    "causedBy",
    "relate",
    "duplicate",
] as const;

export type KnownRelationType = (typeof KNOWN_RELATION_TYPES)[number];

/** 业务实体节点（服务端下发）；depth/kind/position 等由前端计算 */
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
