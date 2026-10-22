import type { NexusAppContext } from "@pc-nexus/core";
import { ces } from "@pc-nexus/storage";
import { KG_EDGE_TYPE, type KgEdge } from "../models/pc-kg-edge.js";
import { KG_NODE_ENTITY_NAME, isKgNodeId, type KgNode, type KgNodeKind } from "../models/pc-kg-node.js";
import { kgService } from "../services/kg-service.js";
import { isVisible } from "../services/visibility.js";
import {
    RELATION_NODE_LIMIT,
    SEARCH_LIMIT,
    matchRank,
    presentNode,
    presentNodeSummary,
    type ToolCommand,
    type ToolResult,
} from "./contract.js";

interface KgNodeQuery {
    id: string;
    kind: string;
    name: string;
    identifier: string;
    summary: string;
    active: boolean;
}

const SEARCH_CANDIDATES = 20;

export async function executeGraphTool(context: NexusAppContext, command: ToolCommand): Promise<ToolResult> {
    if (command.name === "search_nodes") {
        return searchNodes(command.query, command.kind);
    }
    if (command.name === "get_node") {
        return getNode(command.nodeId, command.includeContact);
    }
    return getRelations(context, command);
}

async function searchNodes(query: string, kind: KgNodeKind | undefined): Promise<ToolResult> {
    let found: KgNode[];
    try {
        found = await findCandidates(query, kind);
    } catch {
        return failure("节点检索失败");
    }
    const active = found.filter((node) => node.active !== false);
    if (found.length > 0 && active.length === 0) {
        return failure("匹配的节点已删除");
    }
    const visible = await filterVisible(active);
    visible.sort((left, right) => matchRank(left, query) - matchRank(right, query) || left.id.localeCompare(right.id));
    const matches = visible.slice(0, SEARCH_LIMIT).map((node) => presentNodeSummary(node));
    const exactIdentifier = visible.some((node) => matchRank(node, query) === 0);
    return {
        ok: true,
        summary: matches.length === 0 ? "没有可见匹配" : `命中 ${matches.length} 个节点`,
        body: {
            matches,
            truncated: found.length >= SEARCH_CANDIDATES || visible.length > SEARCH_LIMIT,
            exactIdentifier,
        },
    };
}

async function getNode(nodeId: string, includeContact: boolean): Promise<ToolResult> {
    const node = await requireReadable(nodeId);
    if ("error" in node) {
        return failure(node.error);
    }
    const presented = presentNode(node, includeContact);
    return {
        ok: true,
        summary: presented.identifier ? `${presented.identifier} ${presented.name}` : presented.name,
        body: presented,
    };
}

async function getRelations(
    context: NexusAppContext,
    command: Extract<ToolCommand, { name: "get_relations" }>,
): Promise<ToolResult> {
    const node = await requireReadable(command.nodeId);
    if ("error" in node) {
        return failure(node.error);
    }
    let relation;
    try {
        relation = await kgService.getDeepRelation(context, command.nodeId, command.types, command.depth, command.direction);
    } catch {
        return failure("关系查询失败");
    }

    const truncated = relation.nodes.length > RELATION_NODE_LIMIT;
    const kept = truncated ? relation.nodes.slice(0, RELATION_NODE_LIMIT) : relation.nodes;
    const keptIds = new Set(kept.map((item) => item.node.id));
    const edges = relation.edges
        .filter((edge) => keptIds.has(edge.from_id) && keptIds.has(edge.to_id))
        .map((edge) => presentEdge(edge));
    const notes: string[] = [];
    if (command.depthClamped) {
        notes.push("depth 已限制为 3");
    }
    if (truncated) {
        notes.push(`结果已截断，只保留前 ${RELATION_NODE_LIMIT} 个节点`);
    }
    if (edges.length === 0) {
        notes.push("没有这类关系");
    }

    const body: Record<string, unknown> = {
        rootId: relation.rootId,
        direction: relation.direction,
        depth: relation.depth,
        truncated,
        nodes: kept.map((item) => ({ ...presentNodeSummary(item.node), depth: item.depth })),
        edges,
    };
    if (notes.length > 0) {
        body["note"] = notes.join("；");
    }
    return {
        ok: true,
        summary: `${edges.length} 条边，${kept.length} 个节点`,
        body,
    };
}

async function findCandidates(query: string, kind: KgNodeKind | undefined): Promise<KgNode[]> {
    const found = await ces.entity<KgNodeQuery>(KG_NODE_ENTITY_NAME).find((cb) => {
        cb.and((and) => {
            if (kind) {
                and.field("kind").eq(kind);
            }
            if (isKgNodeId(query)) {
                and.field("id").eq(query);
                return;
            }
            const variants = query.toUpperCase() === query ? [query] : [query, query.toUpperCase()];
            and.or((or) => {
                for (const variant of variants) {
                    or.field("identifier").eq(variant);
                    or.field("identifier").contains(variant);
                    or.field("name").contains(variant);
                    or.field("summary").contains(variant);
                }
            });
        });
    }, { limit: SEARCH_CANDIDATES });
    return found as unknown as KgNode[];
}

async function requireReadable(nodeId: string): Promise<KgNode | { error: string }> {
    let nodes: KgNode[];
    try {
        nodes = await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).find((cb) => {
            cb.field("id").eq(nodeId);
        }, { limit: 1 });
    } catch {
        return { error: "节点检索失败" };
    }
    const node = nodes[0];
    if (!node) {
        return { error: "图谱里没有这个节点，可能尚未同步" };
    }
    if (node.active === false) {
        return { error: "这个节点已删除" };
    }
    try {
        if (!(await isVisible(node.kind, node.ref_id))) {
            return { error: "当前用户看不到这个节点" };
        }
    } catch {
        return { error: "暂时无法确认这个节点是否可见" };
    }
    return node;
}

async function filterVisible(nodes: KgNode[]): Promise<KgNode[]> {
    const flags = await Promise.all(nodes.map(async (node) => {
        try {
            return await isVisible(node.kind, node.ref_id);
        } catch {
            return false;
        }
    }));
    return nodes.filter((_, index) => flags[index]);
}

function presentEdge(edge: KgEdge): { from_id: string; type: string; to_id: string; symmetric?: boolean } {
    const presented: { from_id: string; type: string; to_id: string; symmetric?: boolean } = {
        from_id: edge.from_id,
        type: edge.type,
        to_id: edge.to_id,
    };
    if (edge.type === KG_EDGE_TYPE.relates) {
        presented.symmetric = true;
    }
    return presented;
}

function failure(message: string): ToolResult {
    return { ok: false, summary: message, body: { error: message } };
}
