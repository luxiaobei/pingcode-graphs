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
    cause: "原因",
    causedBy: "结果",
    relate: "关联",
    duplicate: "重复",
    clone: "拷贝",
    clonedBy: "副本",
};

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

function toDirectedEdge(
    sourceId: string,
    relation: WorkItemRelation,
    related: GraphWorkItem,
): GraphEdge | null {
    const relationType = relation.relation_type?.trim();
    if (!relationType) {
        return null;
    }

    const edgeId = relation.id ?? `${sourceId}:${relationType}:${related.id}`;
    return {
        id: edgeId,
        source: sourceId,
        target: related.id,
        relationType,
        label: RELATION_LABELS[relationType] ?? relationType,
    };
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
                const rawType = relation.relation_type?.trim();
                if (!rawType || !allowedTypes.has(rawType)) {
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
                        // permission / missing detail
                    }
                }

                const nextDepth = current.level + 1;
                nodes.set(related.id, {
                    ...nodes.get(related.id),
                    ...related,
                });

                const edge = toDirectedEdge(current.id, relation, related);
                if (edge) {
                    edges.set(edge.id, edge);
                }

                if (nextDepth < depth && !visited.has(related.id)) {
                    queue.push({ id: related.id, level: nextDepth });
                }
            }
        }

        const edgeList = [...edges.values()];
        return {
            rootId: workitemId,
            depth,
            nodes: [...nodes.values()],
            edges: edgeList,
        };
    }
}

export const graphService = new GraphService();
