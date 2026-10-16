import type { NexusAppContext } from "@pc-nexus/core";
import { ces } from "@pc-nexus/storage";
import { KG_EDGE_ENTITY_NAME, type KgEdge, type KgEdgeType } from "../models/pc-kg-edge.js";
import { KG_NODE_ENTITY_NAME, type KgNode } from "../models/pc-kg-node.js";
import { KG_VIEW_ENTITY_NAME, kgViewId, type KgView } from "../models/pc-kg-view.js";

/** outgoing：from → to；incoming：to → from；both：不区分存储方向。 */
export type KgRelationDirection = "outgoing" | "incoming" | "both";

export interface KgReachedNode {
    node: KgNode;
    /** 相对起点的跳数，起点为 0。 */
    depth: number;
}

export interface KgDeepRelation {
    rootId: string;
    types: KgEdgeType[];
    depth: number;
    direction: KgRelationDirection;
    nodes: KgReachedNode[];
    edges: KgEdge[];
}

export interface GetDeepRelationPayload {
    nodeId: string;
    type: KgEdgeType | KgEdgeType[];
    depth: number;
    direction?: KgRelationDirection;
}

export interface SaveViewPositionPayload {
    nodeId: string;
    position: unknown;
    /** 用户级关系方位偏好（跨工作项共用），不写入 position.positions */
    relationSides?: Record<string, string>;
}

export interface GetViewPositionPayload {
    nodeId: string;
}

/** 用户级关系方位偏好的占位 node_id（与具体工作项无关）。 */
export const RELATION_SIDES_NODE_ID = "__relation_sides__";

const VIEW_SIDES = new Set(["left", "right", "top", "bottom"]);

function neighborId(edge: KgEdge, frontier: ReadonlySet<string>, direction: KgRelationDirection): string | undefined {
    if (direction !== "incoming" && frontier.has(edge.from_id)) {
        return edge.to_id;
    }
    if (direction !== "outgoing" && frontier.has(edge.to_id)) {
        return edge.from_id;
    }
    return undefined;
}

function normalizeTypes(type: KgEdgeType | readonly KgEdgeType[]): KgEdgeType[] {
    const types = Array.isArray(type) ? type : [type];
    return [...new Set(types)];
}

async function findRelationEdges(nodeIds: string[], types: readonly KgEdgeType[], direction: KgRelationDirection): Promise<KgEdge[]> {
    if (nodeIds.length === 0 || types.length === 0) {
        return [];
    }
    const edges = await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).find((cb) => {
        cb.and((and) => {
            if (types.length === 1) {
                and.field("type").eq(types[0]!);
            } else {
                and.or((or) => {
                    for (const type of types) {
                        or.field("type").eq(type);
                    }
                });
            }
            if (nodeIds.length === 1 && direction === "outgoing") {
                and.field("from_id").eq(nodeIds[0]!);
                return;
            }
            if (nodeIds.length === 1 && direction === "incoming") {
                and.field("to_id").eq(nodeIds[0]!);
                return;
            }
            and.or((or) => {
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
     * 从节点出发，沿一种或多种关系逐层扩展。
     * type 可传单个类型或类型数组，同一层会一次查出这些关系。
     * depth 为最大嵌套层数，1 表示只取直接关联。
     */
    async getDeepRelation(
        context: NexusAppContext,
        nodeId: string,
        type: KgEdgeType | readonly KgEdgeType[],
        depth: number,
        direction?: KgRelationDirection,
    ): Promise<KgDeepRelation> {
        if (!nodeId) {
            throw new Error("Node id is required");
        }
        const types = normalizeTypes(type);
        if (types.length === 0) {
            throw new Error("Relation type is required");
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
            const found = await findRelationEdges(frontier, types, resolvedDirection);
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
            types,
            depth: maxDepth,
            direction: resolvedDirection,
            nodes: reached,
            edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id)),
        };
    }

    async saveViewPosition(
        context: NexusAppContext,
        nodeId: string,
        position: unknown,
        relationSides?: Record<string, string>,
    ): Promise<void> {
        const userId = requireUserId(context);
        if (!nodeId) {
            throw new Error("Node id is required");
        }
        if (!isPlainObject(position)) {
            throw new Error("Position must be an object");
        }

        await upsertUserView(userId, nodeId, position);

        if (relationSides !== undefined) {
            await upsertUserView(userId, RELATION_SIDES_NODE_ID, {
                relationSides: normalizeRelationSides(relationSides),
            });
        }
    }

    async getViewPosition(context: NexusAppContext, nodeId: string): Promise<Record<string, unknown> | null> {
        const userId = requireUserId(context);
        if (!nodeId) {
            throw new Error("Node id is required");
        }
        const view = await findUserView(userId, nodeId);
        const position = view && isPlainObject(view.position) ? { ...view.position } : null;
        const sidesView = await findUserView(userId, RELATION_SIDES_NODE_ID);
        const relationSides = readRelationSides(sidesView?.position);
        if (!position && !relationSides) {
            return null;
        }
        return {
            ...(position ?? {}),
            ...(relationSides ? { relationSides } : {}),
        };
    }
}

function requireUserId(context: NexusAppContext): string {
    const userId = context.user?.id;
    if (!userId) {
        throw new Error("User id is required");
    }
    return userId;
}

async function findUserView(userId: string, nodeId: string): Promise<KgView | undefined> {
    const views = await ces.entity<KgView>(KG_VIEW_ENTITY_NAME).find((cb) => {
        cb.field("user_id").eq(userId);
        cb.field("node_id").eq(nodeId);
    });
    return views[0];
}

async function upsertUserView(userId: string, nodeId: string, position: Record<string, unknown>): Promise<void> {
    const existing = await findUserView(userId, nodeId);
    if (existing) {
        await ces.entity<KgView>(KG_VIEW_ENTITY_NAME).update((cb) => {
            cb.field("user_id").eq(userId);
            cb.field("node_id").eq(nodeId);
        }, { position });
        return;
    }
    await ces.entity(KG_VIEW_ENTITY_NAME).insert({
        id: kgViewId(userId, nodeId),
        user_id: userId,
        node_id: nodeId,
        position,
    });
}

function normalizeRelationSides(raw: Record<string, string>): Record<string, string> {
    const next: Record<string, string> = {};
    for (const [type, side] of Object.entries(raw)) {
        if (typeof type === "string" && type && VIEW_SIDES.has(side)) {
            next[type] = side;
        }
    }
    return next;
}

function readRelationSides(position: unknown): Record<string, string> | null {
    if (!isPlainObject(position) || !isPlainObject(position.relationSides)) {
        return null;
    }
    const sides = normalizeRelationSides(position.relationSides as Record<string, string>);
    return Object.keys(sides).length ? sides : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export const kgService = new KgService();