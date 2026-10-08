import type { EventHandler } from "@pc-nexus/event";
import { createWorkItemNode } from "../../models/pjm/work-item-node.js";
import { ces } from "@pc-nexus/storage";
import { KG_NODE_ENTITY_NAME, type KgNode } from "../../models/pc-kg-node.js";

export const onWorkitemCreatedHandler: EventHandler = async (context, event) => {
    const workitemInfo = (event.payload as any)["data"];
    const workitemNode = createWorkItemNode({
        refId: workitemInfo["id"],
        name: workitemInfo["title"],
        identifier: workitemInfo["identifier"],
        typeName: workitemInfo["type"],
        stateType: workitemInfo["state"]["type"],
        stateName: workitemInfo["state"]["name"],
        priority: workitemInfo["priority"]["name"],
        startAt: workitemInfo["start_at"],
        endAt: workitemInfo["end_at"],
        description: workitemInfo["description"],
        assigneeName: workitemInfo["assignee"]["name"],
        sprintName: workitemInfo["sprint"]["name"],
        sourceUpdatedAt: workitemInfo["updated_at"],
        syncedAt: workitemInfo["updated_at"],
        active: true,
        storyPoints: workitemInfo["properties"]["story_points"],
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(workitemNode);
};

export const onWorkitemUpdatedHandler: EventHandler = async (context, event) => {
    const workitemInfo = (event.payload as any)["data"];
    const workitemNode = createWorkItemNode({
        refId: workitemInfo["id"],
        name: workitemInfo["title"],
        identifier: workitemInfo["identifier"],
        typeName: workitemInfo["type"],
        stateType: workitemInfo["state"]["type"],
        stateName: workitemInfo["state"]["name"],
        priority: workitemInfo["priority"]["name"],
        startAt: workitemInfo["start_at"],
        endAt: workitemInfo["end_at"],
        description: workitemInfo["description"],
        assigneeName: workitemInfo["assignee"]["name"],
        sprintName: workitemInfo["sprint"]["name"],
        sourceUpdatedAt: workitemInfo["updated_at"],
        syncedAt: workitemInfo["updated_at"],
        active: true,
        storyPoints: workitemInfo["properties"]["story_points"],
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(workitemNode.kind);
        cb.field("ref_id").eq(workitemNode.ref_id);
    }, workitemNode);
};

export const onWorkitemDeletedHandler: EventHandler = async (context, event) => {
    const workitemInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb => {
        cb.field("ref_id").eq(workitemInfo["id"]);
    }), { active: false });
};