import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createProjectNode, type ProjectKgNode } from "../../models/pjm/project-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode } from "../../models/pc-kg-node.js";
import { createKgEdge, deleteEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE } from "../../models/pc-kg-edge.js";
import type { KgEdge } from "../../models/pc-kg-edge.js";

export const onProjectCreatedHandler: EventHandler = async (context, event) => {
    const projectInfo = (event.payload as any)["data"];
    const projectNode = createProjectNode({
        refId: projectInfo["id"],
        name: projectInfo["name"],
        identifier: projectInfo["identifier"],
        templateType: projectInfo["type"],
        stateType: projectInfo["state"]?.["type"],
        stateName: projectInfo["state"]?.["name"],
        description: projectInfo["description"],
        startAt: projectInfo["start_at"],
        endAt: projectInfo["end_at"],
        isLocalConfigure: projectInfo["is_local_config_enabled"] === 1,
        sourceUpdatedAt: projectInfo["updated_at"],
        syncedAt: projectInfo["updated_at"],
        active: true,
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(projectNode);
    createProjectEdges(projectNode, projectInfo);
};

export const onProjectUpdatedHandler: EventHandler = async (context, event) => {
    const projectInfo = (event.payload as any)["data"];
    const changelog = (event.payload as any)["changelog"];
    const projectNode = createProjectNode({
        refId: projectInfo["id"],
        name: projectInfo["name"],
        identifier: projectInfo["identifier"],
        templateType: projectInfo["type"],
        stateType: projectInfo["state"]?.["type"],
        stateName: projectInfo["state"]?.["name"],
        description: projectInfo["description"],
        startAt: projectInfo["start_at"],
        endAt: projectInfo["end_at"],
        isLocalConfigure: projectInfo["is_local_config_enabled"] === 1,
        sourceUpdatedAt: projectInfo["updated_at"],
        syncedAt: projectInfo["updated_at"],
        active: true,
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(projectNode.kind);
        cb.field("ref_id").eq(projectNode.ref_id);
    }, projectNode);
    createProjectEdges(projectNode, projectInfo, changelog);
};

export const onProjectDeletedHandler: EventHandler = async (context, event) => {
    const projectInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.project);
        cb.field("ref_id").eq(projectInfo["id"]);
    }, { active: false });
};
async function createProjectEdges(projectNode: ProjectKgNode, projectInfo: any, changelog?: any) {
    const edges: KgEdge[] = [];
    if (projectInfo["assignee"] && (!changelog || changelog.origin.assignee !== changelog.target.assignee)) {
        edges.push(createKgEdge({
            fromId: projectNode.id,
            toId: kgNodeId(KG_NODE_KIND.user, projectInfo["assignee"]?.["id"]),
            type: KG_EDGE_TYPE.assignedTo,
        }));
        await deleteEdge(projectNode.id, KG_EDGE_TYPE.assignedTo);
    } else if (changelog && changelog.target.assignee === null) {
        await deleteEdge(projectNode.id, KG_EDGE_TYPE.assignedTo);
    }
    if (edges.length > 0) {
        await ces.entity(KG_EDGE_ENTITY_NAME).insert(edges);
    }
}
