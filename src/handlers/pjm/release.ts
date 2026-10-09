import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createReleaseNode, type ReleaseKgNode } from "../../models/pjm/release-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode } from "../../models/pc-kg-node.js";
import { createKgEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge } from "../../models/pc-kg-edge.js";

export const onReleaseCreatedHandler: EventHandler = async (context, event) => {
    const releaseInfo = (event.payload as any)["data"];
    const releaseNode = createReleaseNode({
        refId: releaseInfo["id"],
        name: releaseInfo["name"],
        stageName: releaseInfo["stage"]?.["name"],
        startAt: releaseInfo["start_at"],
        sourceUpdatedAt: releaseInfo["updated_at"],
        syncedAt: releaseInfo["updated_at"],
        active: true,
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(releaseNode);
    createReleaseEdges(releaseNode, (event.payload as any)["data"]);
};

export const onReleaseUpdatedHandler: EventHandler = async (context, event) => {
    const releaseInfo = (event.payload as any)["data"];
    const releaseNode = createReleaseNode({
        refId: releaseInfo["id"],
        name: releaseInfo["name"],
        stageName: releaseInfo["stage"]?.["name"],
        startAt: releaseInfo["start_at"],
        sourceUpdatedAt: releaseInfo["updated_at"],
        syncedAt: releaseInfo["updated_at"],
        active: true,
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(releaseNode.kind);
        cb.field("ref_id").eq(releaseNode.ref_id);
    }, releaseNode);
    createReleaseEdges(releaseNode, (event.payload as any)["data"]);
};

export const onReleaseDeletedHandler: EventHandler = async (context, event) => {
    const releaseInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.release);
        cb.field("ref_id").eq(releaseInfo["id"]);
    }, { active: false });
};

async function createReleaseEdges(releaseNode: ReleaseKgNode, releaseInfo: any) {
    const edges: KgEdge[] = [];
    if (releaseInfo["project"]) {
        edges.push(createKgEdge({
            fromId: releaseNode.id,
            toId: kgNodeId(KG_NODE_KIND.project, releaseInfo["project"]?.["id"]),
            type: KG_EDGE_TYPE.belongsTo,
        }));
        await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).delete((cb) => {
            cb.field("from_id").eq(releaseNode.id);
            cb.field("type").eq(KG_EDGE_TYPE.belongsTo);
        });
    }
    if (releaseInfo["assignee"]) {
        edges.push(createKgEdge({
            fromId: releaseNode.id,
            toId: kgNodeId(KG_NODE_KIND.user, releaseInfo["assignee"]?.["id"]),
            type: KG_EDGE_TYPE.assignedTo,
        }));
        await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).delete((cb) => {
            cb.field("from_id").eq(releaseNode.id);
            cb.field("type").eq(KG_EDGE_TYPE.assignedTo);
        });
    }
    if (edges.length > 0) {
        await ces.entity(KG_EDGE_ENTITY_NAME).insert(edges);
    }
}
