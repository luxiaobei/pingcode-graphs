import { KG_NODE_KIND, assignDefined, createKgNode, excerptText, joinSummary, type KgNodeBase } from "../pc-kg-node.js";

export interface TicketNodeDetail {
    state_type?: string;
    state_name?: string;
    description_excerpt?: string;
    priority?: string;
    solution?: string;
    channel?: string;
    estimated_at?: number;
    vote_count?: number;
    type_name?: string;
    assignee_avatar?: string;
}

export interface TicketKgNode extends KgNodeBase<typeof KG_NODE_KIND.ticket, TicketNodeDetail> {}

export interface TicketNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    stateType?: string;
    stateName?: string;
    description?: string;
    priority?: string;
    solution?: string;
    channel?: string;
    estimatedAt?: number;
    voteCount?: number;
    typeName?: string;
    assigneeAvatar?: string;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createTicketNode(input: TicketNodeInput): TicketKgNode {
    const detail: TicketNodeDetail = {};
    assignDefined(detail, "state_type", input.stateType);
    assignDefined(detail, "state_name", input.stateName);
    assignDefined(detail, "description_excerpt", excerptText(input.description));
    assignDefined(detail, "priority", input.priority);
    assignDefined(detail, "solution", input.solution);
    assignDefined(detail, "channel", input.channel);
    assignDefined(detail, "estimated_at", input.estimatedAt);
    assignDefined(detail, "vote_count", input.voteCount);
    assignDefined(detail, "type_name", input.typeName);
    assignDefined(detail, "assignee_avatar", input.assigneeAvatar);

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.ticket,
        {
            ...input,
            summary: joinSummary([title, input.typeName, input.stateName, input.priority, input.solution]),
        },
        detail,
    );
}
