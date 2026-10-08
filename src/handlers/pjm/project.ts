import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createProjectNode } from "../../models/pjm/project-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, type KgNode } from "../../models/pc-kg-node.js";

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
};

export const onProjectUpdatedHandler: EventHandler = async (context, event) => {
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
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(projectNode.kind);
        cb.field("ref_id").eq(projectNode.ref_id);
    }, projectNode);
};

export const onProjectDeletedHandler: EventHandler = async (context, event) => {
    const projectInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.project);
        cb.field("ref_id").eq(projectInfo["id"]);
    }, { active: false });
};
