import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createProductNode } from "../../models/ship/product-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, type KgNode } from "../../models/pc-kg-node.js";

export const onProductCreatedHandler: EventHandler = async (context, event) => {
    const productInfo = (event.payload as any)["data"];
    const productNode = createProductNode({
        refId: productInfo["id"],
        name: productInfo["name"],
        identifier: productInfo["identifier"],
        description: productInfo["description"],
        sourceUpdatedAt: productInfo["updated_at"],
        syncedAt: productInfo["updated_at"],
        active: true,
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(productNode);
};

export const onProductUpdatedHandler: EventHandler = async (context, event) => {
    const productInfo = (event.payload as any)["data"];
    const productNode = createProductNode({
        refId: productInfo["id"],
        name: productInfo["name"],
        identifier: productInfo["identifier"],
        description: productInfo["description"],
        sourceUpdatedAt: productInfo["updated_at"],
        syncedAt: productInfo["updated_at"],
        active: true,
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(productNode.kind);
        cb.field("ref_id").eq(productNode.ref_id);
    }, productNode);
};

export const onProductDeletedHandler: EventHandler = async (context, event) => {
    const productInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.product);
        cb.field("ref_id").eq(productInfo["id"]);
    }, { active: false });
};
