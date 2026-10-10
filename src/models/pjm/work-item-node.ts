import { KG_NODE_KIND, assignDefined, createKgNode, excerptText, joinSummary, type KgNodeBase } from "../pc-kg-node.js";

/** 负责人、迭代、父项是独立节点，不放在 detail 里。 */
export interface WorkItemNodeDetail {
    type_name?: string;
    type_icon?: string;
    type_color?: string;
    state_type?: string;
    state_name?: string;
    priority?: string;
    start_at?: number;
    end_at?: number;
    description_excerpt?: string;
    story_points?: number;
    assignee_avatar?: string;
}

export interface WorkItemKgNode extends KgNodeBase<typeof KG_NODE_KIND.workItem, WorkItemNodeDetail> {}

export interface WorkItemNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    typeName?: string;
    typeIcon?: string;
    typeColor?: string;
    stateType?: string;
    stateName?: string;
    priority?: string;
    startAt?: number;
    endAt?: number;
    description?: string;
    assigneeName?: string;
    assigneeAvatar?: string;
    sprintName?: string;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
    storyPoints?: number;
}

export function createWorkItemNode(input: WorkItemNodeInput): WorkItemKgNode {
    const detail: WorkItemNodeDetail = {};
    assignDefined(detail, "type_name", input.typeName);
    assignDefined(detail, "story_points", input.storyPoints);
    assignDefined(detail, "state_type", input.stateType);
    assignDefined(detail, "state_name", input.stateName);
    assignDefined(detail, "priority", input.priority);
    assignDefined(detail, "start_at", input.startAt);
    assignDefined(detail, "end_at", input.endAt);
    assignDefined(detail, "description_excerpt", excerptText(input.description));
    assignDefined(detail, "assignee_avatar", input.assigneeAvatar);
    assignDefined(detail, "type_icon", input.typeIcon);
    assignDefined(detail, "type_color", input.typeColor);

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.workItem,
        {
            ...input,
            summary: joinSummary([title, input.typeName, input.stateName, input.priority, input.assigneeName, input.sprintName]),
        },
        detail,
    );
}
