import { api } from "@pc-nexus/network";
import { ces } from "@pc-nexus/storage";
import { createKgEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge, type KgEdgeType } from "../models/pc-kg-edge.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode, type KgNodeKind } from "../models/pc-kg-node.js";
import { ensureGraphNode } from "./node-seed.js";

const PAGE_SIZE = 100;

/** 这两类接口才能提供的边。父项、归属在打开图谱时按详情写入。 */
const RELATION_SYNC_EDGE_TYPES = new Set<KgEdgeType>([
    KG_EDGE_TYPE.blocks,
    KG_EDGE_TYPE.blockedBy,
    KG_EDGE_TYPE.causes,
    KG_EDGE_TYPE.causedBy,
    KG_EDGE_TYPE.duplicates,
    KG_EDGE_TYPE.mentions,
    KG_EDGE_TYPE.clones,
    KG_EDGE_TYPE.clonedBy,
    KG_EDGE_TYPE.relates,
]);

/** 与 link 事件里 relation_type.category 的映射一致。 */
const CATEGORY_EDGE_TYPE: Record<string, KgEdgeType> = {
    relate: KG_EDGE_TYPE.relates,
    duplicate: KG_EDGE_TYPE.duplicates,
    mention: KG_EDGE_TYPE.mentions,
    block: KG_EDGE_TYPE.blocks,
    blocked_by: KG_EDGE_TYPE.blockedBy,
    blockedBy: KG_EDGE_TYPE.blockedBy,
    cause: KG_EDGE_TYPE.causes,
    caused_by: KG_EDGE_TYPE.causedBy,
    causedBy: KG_EDGE_TYPE.causedBy,
    clone: KG_EDGE_TYPE.clones,
    cloned_by: KG_EDGE_TYPE.clonedBy,
    clonedBy: KG_EDGE_TYPE.clonedBy,
};

const API_TYPE_TO_KIND: Record<string, KgNodeKind> = {
    workitem: KG_NODE_KIND.workItem,
    idea: KG_NODE_KIND.idea,
    ticket: KG_NODE_KIND.ticket,
    testcase: KG_NODE_KIND.testCase,
    page: KG_NODE_KIND.page,
};

const KIND_TO_API_TYPE: Partial<Record<KgNodeKind, string>> = {
    [KG_NODE_KIND.workItem]: "workitem",
    [KG_NODE_KIND.idea]: "idea",
    [KG_NODE_KIND.ticket]: "ticket",
    [KG_NODE_KIND.testCase]: "testcase",
    [KG_NODE_KIND.page]: "page",
};

/** 通用关联的 target_type。工作项之间的关联走内部关联接口。 */
const GENERAL_TARGET_TYPES = ["idea", "ticket", "workitem", "testcase", "page"] as const;

interface PagedValues<T> {
    page_index?: number;
    page_size?: number;
    total?: number;
    values?: T[];
}

interface Ref {
    id?: string;
}

interface WorkItemRelationRecord {
    id?: string;
    relation_type?: { category?: string } | string;
    origin_workitem?: Ref;
    origin_work_item?: Ref;
    target_workitem?: Ref;
    target_work_item?: Ref;
}

interface GeneralRelationRecord {
    id?: string;
    principal_type?: string;
    principal?: Ref;
    target_type?: string;
    target?: Ref;
}

const inflight = new Map<string, Promise<void>>();

export function needsRelationSync(types: readonly KgEdgeType[]): boolean {
    return types.some((type) => RELATION_SYNC_EDGE_TYPES.has(type));
}

/** 第一次读取这些节点的关联边时请求 OpenAPI，成功后把 relations_synced 记为 true。 */
export async function ensureRelationsSynced(nodeIds: readonly string[]): Promise<void> {
    const pending = [...new Set(nodeIds)].map((nodeId) => syncNodeRelations(nodeId));
    await Promise.all(pending);
}

function syncNodeRelations(nodeId: string): Promise<void> {
    const current = inflight.get(nodeId);
    if (current) {
        return current;
    }
    const job = syncNodeRelationsOnce(nodeId).finally(() => {
        inflight.delete(nodeId);
    });
    inflight.set(nodeId, job);
    return job;
}

async function syncNodeRelationsOnce(nodeId: string): Promise<void> {
    const parsed = parseNodeId(nodeId);
    if (!parsed) {
        return;
    }
    const node = await findNode(nodeId);
    if (!node || node.relations_synced === true) {
        return;
    }
    const edges = await loadRelationEdges(parsed.kind, parsed.refId);
    await ensureRelationTargets(edges);
    await insertNewEdges(edges);
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("id").eq(nodeId);
    }, { relations_synced: true });
}

async function loadRelationEdges(kind: KgNodeKind, refId: string): Promise<KgEdge[]> {
    const principalType = KIND_TO_API_TYPE[kind];
    if (!principalType) {
        return [];
    }
    const tasks: Array<Promise<KgEdge[]>> = [];
    if (kind === KG_NODE_KIND.workItem) {
        tasks.push(loadWorkItemRelations(refId));
    }
    for (const targetType of GENERAL_TARGET_TYPES) {
        if (kind === KG_NODE_KIND.workItem && targetType === "workitem") {
            continue;
        }
        tasks.push(loadGeneralRelations(principalType, refId, targetType));
    }
    const groups = await Promise.all(tasks);
    return groups.flat();
}

async function loadWorkItemRelations(workItemId: string): Promise<KgEdge[]> {
    const records = await listPages<WorkItemRelationRecord>(
        `/v2/pjm/workitems/${encodeURIComponent(workItemId)}/relations`,
        "Failed to load work item relations",
    );
    return records.flatMap((record) => {
        const fromId = record.origin_workitem?.id ?? record.origin_work_item?.id;
        const toId = record.target_workitem?.id ?? record.target_work_item?.id;
        if (!fromId || !toId) {
            return [];
        }
        const category = typeof record.relation_type === "string"
            ? record.relation_type
            : record.relation_type?.category ?? "";
        return [createKgEdge({
            fromId: kgNodeId(KG_NODE_KIND.workItem, fromId),
            toId: kgNodeId(KG_NODE_KIND.workItem, toId),
            type: CATEGORY_EDGE_TYPE[category] ?? KG_EDGE_TYPE.relates,
        })];
    });
}

async function loadGeneralRelations(principalType: string, principalId: string, targetType: string): Promise<KgEdge[]> {
    const path = `/v2/relations?principal_type=${encodeURIComponent(principalType)}&principal_id=${encodeURIComponent(principalId)}&target_type=${encodeURIComponent(targetType)}`;
    const records = await listPages<GeneralRelationRecord>(path, "Failed to load relations");
    return records.flatMap((record) => {
        const fromKind = record.principal_type ? API_TYPE_TO_KIND[record.principal_type] : undefined;
        const toKind = record.target_type ? API_TYPE_TO_KIND[record.target_type] : undefined;
        const fromId = record.principal?.id;
        const toId = record.target?.id;
        if (!fromKind || !toKind || !fromId || !toId) {
            return [];
        }
        return [createKgEdge({
            fromId: kgNodeId(fromKind, fromId),
            toId: kgNodeId(toKind, toId),
            type: KG_EDGE_TYPE.relates,
        })];
    });
}

/** 关联记录里的 target 还不在图谱中时，按详情补齐该节点及其项目、迭代、发布。 */
async function ensureRelationTargets(edges: KgEdge[]): Promise<void> {
    const pending: string[] = [];
    const seen = new Set<string>();
    for (const edge of edges) {
        if (!edge.to_id || seen.has(edge.to_id)) {
            continue;
        }
        seen.add(edge.to_id);
        pending.push(edge.to_id);
    }
    for (const nodeId of pending) {
        await ensureGraphNode(nodeId);
    }
}

async function insertNewEdges(edges: KgEdge[]): Promise<void> {
    const byId = new Map<string, KgEdge>();
    for (const edge of edges) {
        if (edge.from_id && edge.to_id && edge.from_id !== edge.to_id) {
            byId.set(edge.id, edge);
        }
    }
    const ids = [...byId.keys()];
    if (ids.length === 0) {
        return;
    }
    const existing = await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).find((cb) => {
        if (ids.length === 1) {
            cb.field("id").eq(ids[0]!);
            return;
        }
        cb.or((or) => {
            for (const id of ids) {
                or.field("id").eq(id);
            }
        });
    });
    const have = new Set(existing.map((edge) => edge.id));
    const fresh = ids.flatMap((id) => {
        if (have.has(id)) {
            return [];
        }
        const edge = byId.get(id);
        return edge ? [edge] : [];
    });
    for (let index = 0; index < fresh.length; index += PAGE_SIZE) {
        await ces.entity(KG_EDGE_ENTITY_NAME).insert(fresh.slice(index, index + PAGE_SIZE));
    }
}

async function listPages<T extends { id?: string }>(path: string, errorMessage: string): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let pageIndex = 0;
    const joiner = path.includes("?") ? "&" : "?";
    while (true) {
        const response = await api.invoke(`${path}${joiner}page_index=${pageIndex}&page_size=${PAGE_SIZE}`);
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(errorBody || errorMessage);
        }
        const data = (await response.json()) as PagedValues<T>;
        const values = data.values ?? [];
        const fresh = values.filter((item) => {
            if (!item.id || seen.has(item.id)) {
                return false;
            }
            seen.add(item.id);
            return true;
        });
        items.push(...fresh);
        if (fresh.length === 0 || (typeof data.total === "number" && items.length >= data.total)) {
            break;
        }
        pageIndex += 1;
    }
    return items;
}

async function findNode(nodeId: string): Promise<KgNode | undefined> {
    const found = await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).find((cb) => {
        cb.field("id").eq(nodeId);
    });
    return found[0];
}

function parseNodeId(nodeId: string): { kind: KgNodeKind; refId: string } | undefined {
    const separator = nodeId.indexOf(":");
    if (separator <= 0) {
        return undefined;
    }
    const kind = nodeId.slice(0, separator);
    const refId = nodeId.slice(separator + 1);
    if (!refId || !(kind in KIND_TO_API_TYPE)) {
        return undefined;
    }
    return { kind: kind as KgNodeKind, refId };
}
