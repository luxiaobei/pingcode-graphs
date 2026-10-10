import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createLibraryNode } from "../../models/testhub/library-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, type KgNode } from "../../models/pc-kg-node.js";

export const onLibraryCreatedHandler: EventHandler = async (context, event) => {
    const libraryInfo = (event.payload as any)["data"];
    const libraryNode = createLibraryNode({
        refId: libraryInfo["id"],
        name: libraryInfo["name"],
        identifier: libraryInfo["identifier"],
        description: libraryInfo["description"],
        sourceUpdatedAt: libraryInfo["updated_at"],
        syncedAt: libraryInfo["updated_at"],
        active: true,
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(libraryNode);
};

export const onLibraryUpdatedHandler: EventHandler = async (context, event) => {
    const libraryInfo = (event.payload as any)["data"];
    const libraryNode = createLibraryNode({
        refId: libraryInfo["id"],
        name: libraryInfo["name"],
        identifier: libraryInfo["identifier"],
        description: libraryInfo["description"],
        sourceUpdatedAt: libraryInfo["updated_at"],
        syncedAt: libraryInfo["updated_at"],
        active: true,
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(libraryNode.kind);
        cb.field("ref_id").eq(libraryNode.ref_id);
    }, libraryNode);
};

export const onLibraryDeletedHandler: EventHandler = async (context, event) => {
    const libraryInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.library);
        cb.field("ref_id").eq(libraryInfo["id"]);
    }, { active: false });
};
