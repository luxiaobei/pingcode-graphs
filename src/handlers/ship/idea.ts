import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createIdeaNode } from "../../models/ship/idea-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, type KgNode } from "../../models/pc-kg-node.js";

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
        sourceUpdatedAt: ideaInfo["updated_at"],
        syncedAt: ideaInfo["updated_at"],
        active: true,
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(ideaNode);
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
        sourceUpdatedAt: ideaInfo["updated_at"],
        syncedAt: ideaInfo["updated_at"],
        active: true,
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(ideaNode.kind);
        cb.field("ref_id").eq(ideaNode.ref_id);
    }, ideaNode);
};

export const onIdeaDeletedHandler: EventHandler = async (context, event) => {
    const ideaInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.idea);
        cb.field("ref_id").eq(ideaInfo["id"]);
    }, { active: false });
};
