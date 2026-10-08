import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createTicketNode, type TicketNodeInput } from "../../models/ship/ticket-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, type KgNode } from "../../models/pc-kg-node.js";

function channelName(channel: { name?: string } | string | undefined): string | undefined {
    if (typeof channel === "string") {
        return channel;
    }
    return channel?.name;
}

function toTicketNode(ticketInfo: any) {
    const input: TicketNodeInput = {
        refId: ticketInfo["id"],
        name: ticketInfo["title"],
        identifier: ticketInfo["identifier"],
        stateType: ticketInfo["state"]?.["type"],
        stateName: ticketInfo["state"]?.["name"],
        description: ticketInfo["description"],
        priority: ticketInfo["priority"]?.["name"],
        solution: ticketInfo["solution"]?.["name"],
        estimatedAt: ticketInfo["estimated_at"]?.["to"],
        typeName: ticketInfo["type"]?.["name"],
        sourceUpdatedAt: ticketInfo["updated_at"],
        syncedAt: ticketInfo["updated_at"],
        active: true,
    };
    const channel = channelName(ticketInfo["channel"]);
    if (channel) {
        input.channel = channel;
    }
    return createTicketNode(input);
}

export const onTicketCreatedHandler: EventHandler = async (context, event) => {
    const ticketNode = toTicketNode((event.payload as any)["data"]);
    await ces.entity(KG_NODE_ENTITY_NAME).insert(ticketNode);
};

export const onTicketUpdatedHandler: EventHandler = async (context, event) => {
    const ticketNode = toTicketNode((event.payload as any)["data"]);
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(ticketNode.kind);
        cb.field("ref_id").eq(ticketNode.ref_id);
    }, ticketNode);
};
