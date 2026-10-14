import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createPageNode, type PageKgNode } from "../../models/wiki/page-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode } from "../../models/pc-kg-node.js";
import { createKgEdge, deleteEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge } from "../../models/pc-kg-edge.js";
import { publishEntityChanged } from "../../realtime.js";

export const onPageCreatedHandler: EventHandler = async (context, event) => {
    const pageInfo = (event.payload as any)["data"];
    const pageNode = createPageNode({
        refId: pageInfo["id"],
        name: pageInfo["name"],
        identifier: pageInfo["short_id"],
        typeName: pageInfo["type"],
        sourceUpdatedAt: pageInfo["updated_at"],
        syncedAt: pageInfo["updated_at"],
        active: true,
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(pageNode);
    createPageEdges(pageNode, pageInfo);
    await publishEntityChanged("created", KG_NODE_KIND.page, pageInfo["id"]);
};

export const onPageUpdatedHandler: EventHandler = async (context, event) => {
    const pageInfo = (event.payload as any)["data"];
    const pageNode = createPageNode({
        refId: pageInfo["id"],
        name: pageInfo["name"],
        identifier: pageInfo["short_id"],
        typeName: pageInfo["type"],
        sourceUpdatedAt: pageInfo["updated_at"],
        syncedAt: pageInfo["updated_at"],
        active: true,
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(pageNode.kind);
        cb.field("ref_id").eq(pageNode.ref_id);
    }, pageNode);
    await publishEntityChanged("updated", KG_NODE_KIND.page, pageInfo["id"]);
};

export const onPageDeletedHandler: EventHandler = async (context, event) => {
    const pageInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.page);
        cb.field("ref_id").eq(pageInfo["id"]);
    }, { active: false });
    await publishEntityChanged("deleted", KG_NODE_KIND.page, pageInfo["id"]);
};

async function createPageEdges(pageNode: PageKgNode, pageInfo: any) {
    const edges: KgEdge[] = [];
    if (pageInfo["space"]) {
        edges.push(createKgEdge({
            fromId: pageNode.id,
            toId: kgNodeId(KG_NODE_KIND.space, pageInfo["space"]?.["id"]),
            type: KG_EDGE_TYPE.belongsTo,
        }));
        await deleteEdge(pageNode.id, KG_EDGE_TYPE.belongsTo);
    }
    if (edges.length > 0) {
        await ces.entity(KG_EDGE_ENTITY_NAME).insert(edges);
    }
}
