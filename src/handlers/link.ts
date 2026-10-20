import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { linkKindMap } from "../commons/common.js";
import { createKgEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge, type KgEdgeType } from "../models/pc-kg-edge.js";
import { KG_NODE_KIND, kgNodeId, type KgNode, type KgNodeKind } from "../models/pc-kg-node.js";
import { publishEntityChanged, type EntityChangeAction } from "../realtime.js";

/** relation_type.category → 图谱边类型（含 camelCase / snake_case）。 */
const edgeTypeMap: Record<string, KgEdgeType> = {
    relate: KG_EDGE_TYPE.relates,
    duplicate: KG_EDGE_TYPE.duplicates,
    mention: KG_EDGE_TYPE.mentions,
    block: KG_EDGE_TYPE.blocks,
    blocked_by: KG_EDGE_TYPE.blockedBy,
    blockedBy: KG_EDGE_TYPE.blockedBy,
    cause: KG_EDGE_TYPE.causes,
    caused_by: KG_EDGE_TYPE.causedBy,
    causedBy: KG_EDGE_TYPE.causedBy,
    clone: KG_EDGE_TYPE.clones,
    cloned_by: KG_EDGE_TYPE.clonedBy,
    clonedBy: KG_EDGE_TYPE.clonedBy,
};

export const onLinkAddedHandler: EventHandler = async (context, event) => {
    const principalInfo = (event.payload as any)["data"];
    const targetInfo = (event.payload as any)["changelog"]["target"];
    let toId = "";
    let type: KgEdgeType = KG_EDGE_TYPE.relates;
    let principalKind = linkKindMap[targetInfo["principal_type"]];
    if (targetInfo["target_work_item"]) {
        toId = kgNodeId(KG_NODE_KIND.workItem, targetInfo["target_work_item"]?.["id"]);
        type = edgeTypeMap[targetInfo["relation_type"]?.["category"]] ?? KG_EDGE_TYPE.relates;
        principalKind = KG_NODE_KIND.workItem;
    } else if (targetInfo["target_type"]) {
        toId = kgNodeId(linkKindMap[targetInfo["target_type"]]!, targetInfo["target"]["id"]);
    }
    if (principalKind && toId) {
        const kindId = kgNodeId(principalKind, principalInfo["id"]);
        const edges = await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).find((cb) => {
            cb.field("from_id").eq(kindId);
            cb.field("to_id").eq(toId);
            cb.field("type").eq(type);
        });
        if (edges.length === 0) {
            await ces.entity(KG_EDGE_ENTITY_NAME).insert(createKgEdge({
                fromId: kindId,
                toId,
                type,
            }));
        }
        await publishLinkChanged("link_added", principalKind, principalInfo["id"], toId);
    }
};

export const onLinkRemovedHandler: EventHandler = async (context, event) => {
    const principalInfo = (event.payload as any)["data"];
    const originInfo = (event.payload as any)["changelog"]["origin"];
    let toId = "";
    let type: KgEdgeType = KG_EDGE_TYPE.relates;
    let principalKind = linkKindMap[originInfo["principal_type"]];
    if (originInfo["target_work_item"]) {
        toId = kgNodeId(KG_NODE_KIND.workItem, originInfo["target_work_item"]?.["id"]);
        type = edgeTypeMap[originInfo["relation_type"]?.["category"]] ?? KG_EDGE_TYPE.relates;
        principalKind = KG_NODE_KIND.workItem;
    } else if (originInfo["target_type"]) {
        toId = kgNodeId(linkKindMap[originInfo["target_type"]]!, originInfo["target"]["id"]);
    }
    if (principalKind && toId) {
        const kindId = kgNodeId(principalKind, principalInfo["id"]);
        await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).delete((cb) => {
            cb.or((or) => {
                or.and((and) => {
                    and.field("from_id").eq(kindId);
                    and.field("to_id").eq(toId);
                    and.field("type").eq(type);
                });
                or.and((and) => {
                    and.field("from_id").eq(toId);
                    and.field("to_id").eq(kindId);
                    and.field("type").eq(type);
                });
            });
        });
        await publishLinkChanged("link_removed", principalKind, principalInfo["id"], toId);
    }
};

async function publishLinkChanged(
    action: EntityChangeAction,
    principalKind: KgNodeKind,
    principalRefId: string,
    toId: string,
): Promise<void> {
    await publishEntityChanged(action, principalKind, principalRefId);
    const sep = toId.indexOf(":");
    if (sep > 0) {
        const kind = toId.slice(0, sep) as KgNode["kind"];
        const refId = toId.slice(sep + 1);
        if (refId) {
            await publishEntityChanged(action, kind, refId);
        }
    }
}
