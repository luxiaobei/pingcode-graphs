import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createReleaseNode } from "../../models/pjm/release-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, type KgNode } from "../../models/pc-kg-node.js";

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
};

export const onReleaseDeletedHandler: EventHandler = async (context, event) => {
    const releaseInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.release);
        cb.field("ref_id").eq(releaseInfo["id"]);
    }, { active: false });
};
