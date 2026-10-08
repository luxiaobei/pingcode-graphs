import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createPageNode } from "../../models/wiki/page-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, type KgNode } from "../../models/pc-kg-node.js";

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
};

export const onPageDeletedHandler: EventHandler = async (context, event) => {
    const pageInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.page);
        cb.field("ref_id").eq(pageInfo["id"]);
    }, { active: false });
};
