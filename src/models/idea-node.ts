import { KG_NODE_KIND, assignDefined, createKgNode, excerptText, joinSummary, type KgNodeBase } from "./pc-kg-node.js";

export interface IdeaNodeDetail {
    state_type?: string;
    state_name?: string;
    description_excerpt?: string;
    priority?: string;
    plan_date_begin_at?: number;
    plan_date_end_at?: number;
    plan_date_granularity?: string;
    real_date_begin_at?: number;
    real_date_end_at?: number;
    real_date_granularity?: string;
}

export interface IdeaKgNode extends KgNodeBase<typeof KG_NODE_KIND.idea, IdeaNodeDetail> {}

export interface IdeaNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    stateType?: string;
    stateName?: string;
    description?: string;
    priority?: string;
    planDateBeginAt?: number;
    planDateEndAt?: number;
    planDateGranularity?: string;
    realDateBeginAt?: number;
    realDateEndAt?: number;
    realDateGranularity?: string;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createIdeaNode(input: IdeaNodeInput): IdeaKgNode {
    const detail: IdeaNodeDetail = {};
    assignDefined(detail, "state_type", input.stateType);
    assignDefined(detail, "state_name", input.stateName);
    assignDefined(detail, "description_excerpt", excerptText(input.description));
    assignDefined(detail, "priority", input.priority);
    assignDefined(detail, "plan_date_begin_at", input.planDateBeginAt);
    assignDefined(detail, "plan_date_end_at", input.planDateEndAt);
    assignDefined(detail, "plan_date_granularity", input.planDateGranularity);
    assignDefined(detail, "real_date_begin_at", input.realDateBeginAt);
    assignDefined(detail, "real_date_end_at", input.realDateEndAt);
    assignDefined(detail, "real_date_granularity", input.realDateGranularity);

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.idea,
        {
            ...input,
            summary: joinSummary([title, input.stateName, input.priority]),
        },
        detail,
    );
}
