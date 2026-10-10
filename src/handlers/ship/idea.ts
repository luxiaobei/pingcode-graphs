import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createIdeaNode, type IdeaKgNode } from "../../models/ship/idea-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode } from "../../models/pc-kg-node.js";
import { createKgEdge, deleteEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge } from "../../models/pc-kg-edge.js";

export const onIdeaCreatedHandler: EventHandler = async (context, event) => {
    const ideaInfo = (event.payload as any)["data"];
    const ideaNode = createIdeaNode({
        refId: ideaInfo["id"],
        name: ideaInfo["title"],
        identifier: ideaInfo["identifier"],
        stateType: ideaInfo["state"]?.["type"],
        stateName: ideaInfo["state"]?.["name"],
        description: ideaInfo["description"],
        priority: ideaInfo["priority"]?.["name"],
        planDateBeginAt: ideaInfo["plan_at"]?.["from"],
        planDateEndAt: ideaInfo["plan_at"]?.["to"],
        planDateGranularity: ideaInfo["plan_at"]?.["granularity"],
        realDateBeginAt: ideaInfo["real_at"]?.["from"],
        realDateEndAt: ideaInfo["real_at"]?.["to"],
        realDateGranularity: ideaInfo["real_at"]?.["granularity"],
        assigneeAvatar: ideaInfo["assignee"]?.["avatar"],
        sourceUpdatedAt: ideaInfo["updated_at"],
        syncedAt: ideaInfo["updated_at"],
        active: true,
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(ideaNode);
    createIdeaEdges(ideaNode, ideaInfo);
};

export const onIdeaUpdatedHandler: EventHandler = async (context, event) => {
    const ideaInfo = (event.payload as any)["data"];
    const ideaNode = createIdeaNode({
        refId: ideaInfo["id"],
        name: ideaInfo["title"],
        identifier: ideaInfo["identifier"],
        stateType: ideaInfo["state"]?.["type"],
        stateName: ideaInfo["state"]?.["name"],
        description: ideaInfo["description"],
        priority: ideaInfo["priority"]?.["name"],
        planDateBeginAt: ideaInfo["plan_at"]?.["from"],
        planDateEndAt: ideaInfo["plan_at"]?.["to"],
        planDateGranularity: ideaInfo["plan_at"]?.["granularity"],
        realDateBeginAt: ideaInfo["real_at"]?.["from"],
        realDateEndAt: ideaInfo["real_at"]?.["to"],
        realDateGranularity: ideaInfo["real_at"]?.["granularity"],
        assigneeAvatar: ideaInfo["assignee"]?.["avatar"],
        sourceUpdatedAt: ideaInfo["updated_at"],
        syncedAt: ideaInfo["updated_at"],
        active: true,
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(ideaNode.kind);
        cb.field("ref_id").eq(ideaNode.ref_id);
    }, ideaNode);
    if (["assignee"].includes((event.payload as any).changelog.property.id)) {
        createIdeaEdges(ideaNode, ideaInfo);
        if ((event.payload as any).changelog.target === null) {
            await deleteEdge(ideaNode.id, KG_EDGE_TYPE.assignedTo);
        }
    }
};

export const onIdeaDeletedHandler: EventHandler = async (context, event) => {
    const ideaInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.idea);
        cb.field("ref_id").eq(ideaInfo["id"]);
    }, { active: false });
};

async function createIdeaEdges(ideaNode: IdeaKgNode, ideaInfo: any) {
    const edges: KgEdge[] = [];
    if (ideaInfo["product"]) {
        edges.push(createKgEdge({
            fromId: ideaNode.id,
            toId: kgNodeId(KG_NODE_KIND.product, ideaInfo["product"]?.["id"]),
            type: KG_EDGE_TYPE.belongsTo,
        }));
        await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).delete((cb) => {
            cb.field("from_id").eq(ideaNode.id);
            cb.field("type").eq(KG_EDGE_TYPE.belongsTo);
        });
    }
    if (ideaInfo["assignee"]) {
        edges.push(createKgEdge({
            fromId: ideaNode.id,
            toId: kgNodeId(KG_NODE_KIND.user, ideaInfo["assignee"]?.["id"]),
            type: KG_EDGE_TYPE.assignedTo,
        }));
        await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).delete((cb) => {
            cb.field("from_id").eq(ideaNode.id);
            cb.field("type").eq(KG_EDGE_TYPE.assignedTo);
        });
    }
    if (edges.length > 0) {
        await ces.entity(KG_EDGE_ENTITY_NAME).insert(edges);
    }
}
