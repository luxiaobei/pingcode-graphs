import type { NexusAppContext } from "@pc-nexus/core";
import { ces } from "@pc-nexus/storage";
import { KG_EDGE_ENTITY_NAME, type KgEdge, type KgEdgeType } from "../models/pc-kg-edge.js";
import { KG_NODE_ENTITY_NAME, type KgNode } from "../models/pc-kg-node.js";

/** outgoing：from → to；incoming：to → from；both：不区分存储方向。 */
export type KgRelationDirection = "outgoing" | "incoming" | "both";

export interface KgReachedNode {
    node: KgNode;
    /** 相对起点的跳数，起点为 0。 */
    depth: number;
}

export interface KgDeepRelation {
    rootId: string;
    type: KgEdgeType;
    depth: number;
    direction: KgRelationDirection;
    nodes: KgReachedNode[];
    edges: KgEdge[];
}

export interface GetDeepRelationPayload {
    nodeId: string;
    type: KgEdgeType;
    depth: number;
    direction?: KgRelationDirection;
}

function neighborId(edge: KgEdge, frontier: ReadonlySet<string>, direction: KgRelationDirection): string | undefined {
    if (direction !== "incoming" && frontier.has(edge.from_id)) {
        return edge.to_id;
    }
    if (direction !== "outgoing" && frontier.has(edge.to_id)) {
        return edge.from_id;
    }
    return undefined;
}

async function findRelationEdges(nodeIds: string[], type: KgEdgeType, direction: KgRelationDirection): Promise<KgEdge[]> {
    if (nodeIds.length === 0) {
        return [];
    }
    const edges = await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).find((cb) => {
        cb.field("type").eq(type);
        if (nodeIds.length === 1 && direction === "outgoing") {
            cb.field("from_id").eq(nodeIds[0]!);
            return;
        }
        if (nodeIds.length === 1 && direction === "incoming") {
            cb.field("to_id").eq(nodeIds[0]!);
            return;
        }
        cb.or((or) => {
            for (const id of nodeIds) {
                if (direction !== "incoming") {
                    or.field("from_id").eq(id);
                }
                if (direction !== "outgoing") {
                    or.field("to_id").eq(id);
                }
            }
        });
    });
    return edges.filter((edge) => edge.active !== false);
}

async function findNodesByIds(ids: string[]): Promise<KgNode[]> {
    if (ids.length === 0) {
        return [];
    }
    if (ids.length === 1) {
        return ces.entity<KgNode>(KG_NODE_ENTITY_NAME).find((cb) => {
            cb.field("id").eq(ids[0]!);
        });
    }
    return ces.entity<KgNode>(KG_NODE_ENTITY_NAME).find((cb) => {
        cb.or((or) => {
            for (const id of ids) {
                or.field("id").eq(id);
            }
        });
    });
}

export class KgService {

    /**
     * 从节点出发，沿一种关系逐层扩展。
     * depth 为最大嵌套层数，1 表示只取直接关联。
     * relates 默认双向查找，其余关系默认沿 from → to。
     */
    async getDeepRelation(
        context: NexusAppContext,
        nodeId: string,
        type: KgEdgeType,
        depth: number,
        direction?: KgRelationDirection,
    ): Promise<KgDeepRelation> {
        if (!nodeId) {
            throw new Error("Node id is required");
        }
        if (!Number.isFinite(depth) || depth < 0) {
            throw new Error("Depth must be a non-negative number");
        }

        const maxDepth = Math.floor(depth);
        const resolvedDirection = direction ?? "outgoing";
        const depthOf = new Map<string, number>([[nodeId, 0]]);
        const edges = new Map<string, KgEdge>();
        let frontier = [nodeId];

        for (let level = 0; level < maxDepth && frontier.length > 0; level++) {
            const found = await findRelationEdges(frontier, type, resolvedDirection);
            const frontierSet = new Set(frontier);
            const next: string[] = [];
            for (const edge of found) {
                edges.set(edge.id, edge);
                const nextId = neighborId(edge, frontierSet, resolvedDirection);
                if (!nextId || depthOf.has(nextId)) {
                    continue;
                }
                depthOf.set(nextId, level + 1);
                next.push(nextId);
            }
            frontier = next;
        }

        const nodes = await findNodesByIds([...depthOf.keys()]);
        const reached = nodes
            .map((node) => ({ node, depth: depthOf.get(node.id) ?? 0 }))
            .sort((left, right) => left.depth - right.depth || left.node.id.localeCompare(right.node.id));

        return {
            rootId: nodeId,
            type,
            depth: maxDepth,
            direction: resolvedDirection,
            nodes: reached,
            edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id)),
        };
    }
}

export const kgService = new KgService();