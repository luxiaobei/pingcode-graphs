import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createReleaseNode, type ReleaseKgNode } from "../../models/pjm/release-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode } from "../../models/pc-kg-node.js";
import { createKgEdge, deleteEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge } from "../../models/pc-kg-edge.js";

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
    const changelog = (event.payload as any)["changelog"];
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
    createReleaseEdges(releaseNode, (event.payload as any)["data"], changelog);
};

export const onReleaseDeletedHandler: EventHandler = async (context, event) => {
    const releaseInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.release);
        cb.field("ref_id").eq(releaseInfo["id"]);
    }, { active: false });
};

async function createReleaseEdges(releaseNode: ReleaseKgNode, releaseInfo: any, changelog?: any) {
    const edges: KgEdge[] = [];
    if (releaseInfo["project"] && (!changelog || changelog.origin.project !== changelog.target.project)) {
        edges.push(createKgEdge({
            fromId: releaseNode.id,
            toId: kgNodeId(KG_NODE_KIND.project, releaseInfo["project"]?.["id"]),
            type: KG_EDGE_TYPE.belongsTo,
        }));
        await deleteEdge(releaseNode.id, KG_EDGE_TYPE.belongsTo);
    } else if (changelog && changelog.target.project === null) {
        await deleteEdge(releaseNode.id, KG_EDGE_TYPE.belongsTo);
    }
    if (releaseInfo["assignee"] && (!changelog || changelog.origin.assignee !== changelog.target.assignee)) {
        edges.push(createKgEdge({
            fromId: releaseNode.id,
            toId: kgNodeId(KG_NODE_KIND.user, releaseInfo["assignee"]?.["id"]),
            type: KG_EDGE_TYPE.assignedTo,
        }));
        await deleteEdge(releaseNode.id, KG_EDGE_TYPE.assignedTo);
    } else if (changelog && changelog.target.assignee === null) {
        await deleteEdge(releaseNode.id, KG_EDGE_TYPE.assignedTo);
    }
    if (edges.length > 0) {
        await ces.entity(KG_EDGE_ENTITY_NAME).insert(edges);
    }
}
