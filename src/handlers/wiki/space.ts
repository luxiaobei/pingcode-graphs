import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createSpaceNode } from "../../models/wiki/space-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, type KgNode } from "../../models/pc-kg-node.js";

export const onSpaceCreatedHandler: EventHandler = async (context, event) => {
    const spaceInfo = (event.payload as any)["data"];
    const spaceNode = createSpaceNode({
        refId: spaceInfo["id"],
        name: spaceInfo["name"],
        identifier: spaceInfo["identifier"],
        sourceUpdatedAt: spaceInfo["updated_at"],
        syncedAt: spaceInfo["updated_at"],
        active: true,
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(spaceNode);
};

export const onSpaceUpdatedHandler: EventHandler = async (context, event) => {
    const spaceInfo = (event.payload as any)["data"];
    const spaceNode = createSpaceNode({
        refId: spaceInfo["id"],
        name: spaceInfo["name"],
        identifier: spaceInfo["identifier"],
        sourceUpdatedAt: spaceInfo["updated_at"],
        syncedAt: spaceInfo["updated_at"],
        active: true,
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(spaceNode.kind);
        cb.field("ref_id").eq(spaceNode.ref_id);
    }, spaceNode);
};

export const onSpaceDeletedHandler: EventHandler = async (context, event) => {
    const spaceInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.space);
        cb.field("ref_id").eq(spaceInfo["id"]);
    }, { active: false });
};
