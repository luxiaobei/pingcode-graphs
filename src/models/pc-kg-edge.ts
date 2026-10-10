import { ces } from "@pc-nexus/storage";
import { assignDefined } from "./pc-kg-node.js";

export const KG_EDGE_ENTITY_NAME = "pc_kg_edge";

export const KG_EDGE_TYPE = {
    belongsTo: "belongs_to", // 从属于，例如 workitem 从属于 project
    assignedTo: "assigned_to", // 分配给，例如 workitem 分配给 user
    plannedIn: "planned_in", // 计划在，例如 workitem 计划在 sprint 中
    releasedIn: "released_in", // 发布在，例如 workitem 发布在 release 中
    parentOf: "parent_of", // 父项，例如 workitem 父项是 parent workitem
    blocks: "blocks", // 阻塞
    causes: "causes", // 导致
    dependsOn: "depends_on", // 依赖
    duplicates: "duplicates", // 重复
    mentions: "mentions", // 提及
    clones: "clones", // 克隆
    relates: "relates", // 关联
} as const;

export type KgEdgeType = (typeof KG_EDGE_TYPE)[keyof typeof KG_EDGE_TYPE];

/** 同一 from_id 下每种类型至多一条。替换时先删旧边再插新边，因为边 id 含 to_id。 */
export const UNIQUE_KG_EDGE_TYPES = [
    KG_EDGE_TYPE.belongsTo,
    KG_EDGE_TYPE.assignedTo,
    KG_EDGE_TYPE.plannedIn,
    KG_EDGE_TYPE.releasedIn,
    KG_EDGE_TYPE.parentOf,
] as const;

export type UniqueKgEdgeType = (typeof UNIQUE_KG_EDGE_TYPES)[number];

const UNIQUE_KG_EDGE_TYPE_SET = new Set<KgEdgeType>(UNIQUE_KG_EDGE_TYPES);

const SYMMETRIC_EDGE_TYPES = new Set<KgEdgeType>([KG_EDGE_TYPE.relates]);

export function isUniqueKgEdgeType(type: KgEdgeType): type is UniqueKgEdgeType {
    return UNIQUE_KG_EDGE_TYPE_SET.has(type);
}

export interface KgEdge {
    id: string;
    type: KgEdgeType;
    from_id: string;
    to_id: string;
    symmetric?: boolean;
    active?: boolean;
    synced_at?: number;
}

export interface KgEdgeInput {
    type: KgEdgeType;
    fromId: string;
    toId: string;
    symmetric?: boolean;
    active?: boolean;
    syncedAt?: number;
}

export function kgEdgeId(fromId: string, type: KgEdgeType, toId: string): string {
    return `${fromId}|${type}|${toId}`;
}

export function createKgEdge(input: KgEdgeInput): KgEdge {
    const edge: KgEdge = {
        id: kgEdgeId(input.fromId, input.type, input.toId),
        type: input.type,
        from_id: input.fromId,
        to_id: input.toId,
        symmetric: input.symmetric ?? SYMMETRIC_EDGE_TYPES.has(input.type),
        active: input.active ?? true,
    };
    assignDefined(edge, "synced_at", input.syncedAt);
    return edge;
}

export async function deleteEdge(id: string, type: KgEdgeType, toId?: string) {
    await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).delete((cb) => {
        cb.field("from_id").eq(id);
        cb.field("type").eq(type);
        if (toId) {
            cb.field("to_id").eq(toId);
        }
    });
}
