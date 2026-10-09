import type { NexusAppContext } from "@pc-nexus/core";
import type {
    DependencyGraph,
    GetDependencyGraphPayload,
    GraphEdge,
    GraphWorkItem,
    RelationType,
} from "../types/graph.js";
import { KNOWN_RELATION_TYPES } from "../types/graph.js";
import { workItemService, type WorkItemRelation } from "./work-item.js";

const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 3;
const DEFAULT_RELATION_TYPES: RelationType[] = [...KNOWN_RELATION_TYPES];

const RELATION_LABELS: Record<string, string> = {
    block: "阻塞",
    blockedBy: "被阻塞",
    cause: "导致",
    causedBy: "由…导致",
    relate: "关联",
    duplicate: "重复",
    clone: "拷贝",
    clonedBy: "副本",
};

const INVERSE_TO_CANONICAL: Record<string, string> = {
    blockedBy: "block",
    causedBy: "cause",
};

const RELATION_KEY_ALIASES: Record<string, string> = {
    blocked_by: "blockedBy",
    caused_by: "causedBy",
    cloned_by: "clonedBy",
    拷贝: "clone",
    副本: "clonedBy",
};

const LABEL_TO_TYPE: Record<string, string> = Object.fromEntries(
    Object.entries(RELATION_LABELS).map(([type, label]) => [label, type]),
);

const FILTERABLE_CANONICAL = new Set(
    KNOWN_RELATION_TYPES.map((type) => INVERSE_TO_CANONICAL[type] ?? type),
);

function normalizeRelationKey(value: string): string {
    const trimmed = value.trim();
    if (!trimmed || /^[a-f0-9]{24}$/i.test(trimmed)) {
        return "";
    }
    return RELATION_KEY_ALIASES[trimmed] ?? LABEL_TO_TYPE[trimmed] ?? trimmed;
}

function readRelationType(value: WorkItemRelation["relation_type"]): string | undefined {
    if (typeof value === "string") {
        return normalizeRelationKey(value) || undefined;
    }
    if (!value || typeof value !== "object") {
        return undefined;
    }

    const code = [value.category, value.key, value.name]
        .filter((item): item is string => typeof item === "string")
        .map((item) => normalizeRelationKey(item))
        .find(Boolean);
    return code;
}

function readRelationLabel(value: WorkItemRelation["relation_type"]): string | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const name = value.name?.trim();
    return name || undefined;
}

const WORK_ITEM_FIELDS = [
    "identifier",
    "title",
    "type",
    "state",
    "project",
    "priority",
    "assignee",
] as const satisfies readonly (keyof GraphWorkItem)[];

function normalizeWorkItem(raw: GraphWorkItem | undefined, fallbackId?: string): GraphWorkItem | null {
    const id = raw?.id ?? fallbackId;
    if (!id) {
        return null;
    }
    const item: GraphWorkItem = { id };
    for (const key of WORK_ITEM_FIELDS) {
        const value = raw?.[key];
        if (value) {
            Object.assign(item, { [key]: value });
        }
    }
    return item;
}

function mergeWorkItem(base: GraphWorkItem | undefined, incoming: GraphWorkItem): GraphWorkItem {
    return normalizeWorkItem({ ...base, ...incoming, id: incoming.id }) ?? incoming;
}

function resolveEndpoints(
    currentId: string,
    relation: WorkItemRelation,
): { origin: GraphWorkItem; target: GraphWorkItem } | null {
    const origin =
        normalizeWorkItem(relation.origin_work_item) ??
        normalizeWorkItem(undefined, relation.origin_work_item_id);
    const target =
        normalizeWorkItem(relation.target_work_item) ??
        normalizeWorkItem(relation.work_item) ??
        normalizeWorkItem(undefined, relation.target_work_item_id);

    if (origin && target) {
        return origin.id === target.id ? null : { origin, target };
    }
    if (target && target.id !== currentId) {
        return { origin: { id: currentId }, target };
    }
    if (origin && origin.id !== currentId) {
        return { origin: { id: currentId }, target: origin };
    }
    return null;
}

function isRelationIncluded(rawType: string | undefined, allowed: Set<string>): boolean {
    if (!rawType) {
        return false;
    }
    const canonical = INVERSE_TO_CANONICAL[rawType] ?? rawType;
    if (!FILTERABLE_CANONICAL.has(canonical)) {
        return true;
    }
    for (const type of allowed) {
        const normalized = normalizeRelationKey(type);
        if ((INVERSE_TO_CANONICAL[normalized] ?? normalized) === canonical) {
            return true;
        }
    }
    return false;
}

function toDirectedEdge(
    relation: WorkItemRelation,
    origin: GraphWorkItem,
    target: GraphWorkItem,
): GraphEdge | null {
    if (origin.id === target.id) {
        return null;
    }

    const rawType = readRelationType(relation.relation_type);
    if (!rawType) {
        return null;
    }
    const flip = rawType === "blockedBy" || rawType === "causedBy";
    const canonicalType = INVERSE_TO_CANONICAL[rawType] ?? rawType;
    const from = flip ? target.id : origin.id;
    const to = flip ? origin.id : target.id;

    return {
        id: relation.id ?? `${from}:${canonicalType}:${to}`,
        source: from,
        target: to,
        relationType: canonicalType,
        label: RELATION_LABELS[canonicalType] ?? readRelationLabel(relation.relation_type) ?? canonicalType,
    };
}

function findCriticalPath(rootId: string, edges: GraphEdge[]): string[] {
    const blockEdges = edges.filter((edge) => edge.relationType === "block");
    if (!blockEdges.length) {
        return [rootId];
    }

    const outgoing = new Map<string, string[]>();
    for (const edge of blockEdges) {
        const list = outgoing.get(edge.source) ?? [];
        list.push(edge.target);
        outgoing.set(edge.source, list);
    }

    let bestPath: string[] = [rootId];

    const dfs = (nodeId: string, path: string[], visited: Set<string>) => {
        if (path.length > bestPath.length) {
            bestPath = [...path];
        }
        for (const next of outgoing.get(nodeId) ?? []) {
            if (visited.has(next)) {
                continue;
            }
            visited.add(next);
            path.push(next);
            dfs(next, path, visited);
            path.pop();
            visited.delete(next);
        }
    };

    dfs(rootId, [rootId], new Set([rootId]));
    return bestPath;
}

export class GraphService {
    async getDependencyGraph(
        context: NexusAppContext,
        payload: GetDependencyGraphPayload = {},
    ): Promise<DependencyGraph> {
        const workitemId =
            payload.workitemId ??
            (context.extension?.data as { workitem?: { id?: string } } | undefined)?.workitem?.id;

        if (!workitemId) {
            throw new Error("Work item id is required");
        }

        const depth = Math.min(Math.max(payload.depth ?? DEFAULT_DEPTH, 1), MAX_DEPTH);
        const allowedTypes = new Set(payload.relationTypes?.length ? payload.relationTypes : DEFAULT_RELATION_TYPES);

        const nodes = new Map<string, GraphWorkItem>();
        const edges = new Map<string, GraphEdge>();
        const queue: Array<{ id: string; level: number }> = [{ id: workitemId, level: 0 }];
        const visited = new Set<string>();

        const root = await workItemService.fetchWorkItem(context, workitemId);
        nodes.set(root.id!, root as GraphWorkItem);

        while (queue.length) {
            const current = queue.shift()!;
            if (visited.has(current.id) || current.level >= depth) {
                continue;
            }
            visited.add(current.id);

            const relations = await workItemService.fetchRelations(context, current.id);
            const nextDepth = current.level + 1;
            for (const relation of relations) {
                const rawType = readRelationType(relation.relation_type);
                if (!isRelationIncluded(rawType, allowedTypes)) {
                    continue;
                }

                const endpoints = resolveEndpoints(current.id, relation);
                if (!endpoints) {
                    continue;
                }

                let { origin, target } = endpoints;
                for (const related of [origin, target]) {
                    let node = related;
                    if (node.id !== current.id && (!node.title || !node.identifier)) {
                        try {
                            node = normalizeWorkItem(await workItemService.fetchWorkItem(context, node.id)) ?? node;
                        } catch {
                            // permission / missing detail
                        }
                    }
                    if (node.id === origin.id) {
                        origin = node;
                    }
                    if (node.id === target.id) {
                        target = node;
                    }
                    nodes.set(node.id, mergeWorkItem(nodes.get(node.id), node));
                    if (node.id !== current.id && nextDepth < depth && !visited.has(node.id)) {
                        queue.push({ id: node.id, level: nextDepth });
                    }
                }

                const edge = toDirectedEdge(relation, origin, target);
                if (edge) {
                    edges.set(edge.id, edge);
                }
            }
        }

        const edgeList = [...edges.values()];
        return {
            rootId: workitemId,
            depth,
            nodes: [...nodes.values()],
            edges: edgeList,
            criticalPath: findCriticalPath(workitemId, edgeList),
        };
    }
}

export const graphService = new GraphService();
