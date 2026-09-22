import type { NexusAppContext } from "@pc-nexus/core";
import type {
    DependencyGraph,
    GetDependencyGraphPayload,
    GraphEdge,
    GraphWorkItem,
    RelationType,
} from "../types/graph.js";
import { workItemService, type WorkItemRelation } from "./work-item.js";

const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 3;
const DEFAULT_RELATION_TYPES: RelationType[] = [
    "block",
    "blockedBy",
    "cause",
    "causedBy",
    "relate",
    "duplicate",
];

const RELATION_LABELS: Record<RelationType, string> = {
    block: "阻塞",
    blockedBy: "被阻塞",
    cause: "导致",
    causedBy: "由…导致",
    relate: "关联",
    duplicate: "重复",
};

function isRelationType(value: string | undefined): value is RelationType {
    return !!value && value in RELATION_LABELS;
}

function normalizeWorkItem(raw: GraphWorkItem | undefined, fallbackId?: string): GraphWorkItem | null {
    const id = raw?.id ?? fallbackId;
    if (!id) {
        return null;
    }
    return {
        ...raw,
        id,
    };
}

function resolveRelatedWorkItem(relation: WorkItemRelation): GraphWorkItem | null {
    return (
        normalizeWorkItem(relation.work_item) ??
        normalizeWorkItem(relation.target_work_item) ??
        normalizeWorkItem(undefined, relation.target_work_item_id)
    );
}

/**
 * Normalize PingCode relation into a directed edge.
 * block / cause point from source → target; inverse types are flipped.
 */
function toDirectedEdge(
    sourceId: string,
    relation: WorkItemRelation,
    related: GraphWorkItem,
): GraphEdge | null {
    const relationType = relation.relation_type;
    if (!isRelationType(relationType)) {
        return null;
    }

    let from = sourceId;
    let to = related.id;
    let canonicalType: RelationType = relationType;

    if (relationType === "blockedBy") {
        from = related.id;
        to = sourceId;
        canonicalType = "block";
    } else if (relationType === "causedBy") {
        from = related.id;
        to = sourceId;
        canonicalType = "cause";
    }

    const edgeId = relation.id ?? `${from}:${canonicalType}:${to}`;
    return {
        id: edgeId,
        source: from,
        target: to,
        relationType: canonicalType,
        label: RELATION_LABELS[canonicalType],
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
            for (const relation of relations) {
                if (!isRelationType(relation.relation_type) || !allowedTypes.has(relation.relation_type)) {
                    continue;
                }

                let related = resolveRelatedWorkItem(relation);
                if (!related) {
                    continue;
                }

                if (!related.title || !related.identifier) {
                    try {
                        related = await workItemService.fetchWorkItem(context, related.id);
                    } catch {
                        // Keep the stub node if detail fetch fails (e.g. permission).
                    }
                }

                nodes.set(related.id, { ...nodes.get(related.id), ...related });

                const edge = toDirectedEdge(current.id, relation, related);
                if (edge) {
                    edges.set(edge.id, edge);
                }

                if (current.level + 1 < depth && !visited.has(related.id)) {
                    queue.push({ id: related.id, level: current.level + 1 });
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
