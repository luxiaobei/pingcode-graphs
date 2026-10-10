import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode } from "../models/pc-kg-node.js";
import { createKgEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge } from "../models/pc-kg-edge.js";
import { linkKindMap } from "../commons/common.js";

const edgeTypeMap = {
    "relate": KG_EDGE_TYPE.relates,
    "duplicate": KG_EDGE_TYPE.duplicates,
    "cause": KG_EDGE_TYPE.causes,
    "block": KG_EDGE_TYPE.blocks,
    "mention": KG_EDGE_TYPE.mentions,
    "clone": KG_EDGE_TYPE.clones,
};

export const onLinkAddedHandler: EventHandler = async (context, event) => {
    const principalInfo = (event.payload as any)["data"];
    const targetInfo = (event.payload as any)["changelog"]["target"];
    let toId = "";
    let type = KG_EDGE_TYPE.relates;
    const principalNodes = await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).find((cb) => {
        cb.field("ref_id").eq(principalInfo["id"]);
    });
    if (targetInfo["target_work_item"]) {
        toId = kgNodeId(KG_NODE_KIND.workItem, targetInfo["target_work_item"]?.["id"]);
        type = edgeTypeMap[targetInfo["relation_type"]?.["category"]] ?? KG_EDGE_TYPE.relates;
    } else if (targetInfo["target_type"]) {
        toId = kgNodeId(linkKindMap[targetInfo["target_type"]]!, targetInfo["target"]["id"]);
    }
    if (principalNodes.length > 0 && toId) {
        const edges = await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).find((cb) => {
            cb.field("from_id").eq(principalNodes[0]!.id);
            cb.field("to_id").eq(toId);
            cb.field("type").eq(type);
        });
        if (edges.length === 0) {
            await ces.entity(KG_EDGE_ENTITY_NAME).insert(createKgEdge({
                fromId: principalNodes[0]!.id,
                toId,
                type,
            }));
        }
    }
};

export const onLinkRemovedHandler: EventHandler = async (context, event) => {
    const principalInfo = (event.payload as any)["data"];
    const originInfo = (event.payload as any)["changelog"]["origin"];
    let toId = "";
    let type = KG_EDGE_TYPE.relates;
    const principalNodes = await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).find((cb) => {
        cb.field("ref_id").eq(principalInfo["id"]);
    });
    if (originInfo["target_work_item"]) {
        toId = kgNodeId(KG_NODE_KIND.workItem, originInfo["target_work_item"]?.["id"]);
        type = edgeTypeMap[originInfo["relation_type"]?.["category"]] ?? KG_EDGE_TYPE.relates;
    } else if (originInfo["target_type"]) {
        toId = kgNodeId(linkKindMap[originInfo["target_type"]]!, originInfo["target"]["id"]);
    }
    if (principalNodes.length > 0 && toId) {
        await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).delete((cb) => {
            cb.or((or) => {
                or.and((and) => {
                    and.field("from_id").eq(principalNodes[0]!.id);
                    and.field("to_id").eq(toId);
                    and.field("type").eq(type);
                });
                or.and((and) => {
                    and.field("from_id").eq(toId);
                    and.field("to_id").eq(principalNodes[0]!.id);
                    and.field("type").eq(type);
                });
            });
        });
    }
};