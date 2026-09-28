import { KG_NODE_KIND, assignDefined, createKgNode, excerptText, joinSummary, type KgNodeBase } from "../pc-kg-node.js";

export interface SprintNodeDetail {
    state_name?: string;
    start_at?: number;
    end_at?: number;
    started_at?: number;
    completed_at?: number;
    description_excerpt?: string;
    category_names?: string[];
}

export interface SprintKgNode extends KgNodeBase<typeof KG_NODE_KIND.sprint, SprintNodeDetail> {}

export interface SprintNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    stateName?: string;
    startAt?: number;
    endAt?: number;
    startedAt?: number;
    completedAt?: number;
    description?: string;
    categoryNames?: string[];
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createSprintNode(input: SprintNodeInput): SprintKgNode {
    const detail: SprintNodeDetail = {};
    assignDefined(detail, "state_name", input.stateName);
    assignDefined(detail, "start_at", input.startAt);
    assignDefined(detail, "end_at", input.endAt);
    assignDefined(detail, "started_at", input.startedAt);
    assignDefined(detail, "completed_at", input.completedAt);
    assignDefined(detail, "description_excerpt", excerptText(input.description));
    assignDefined(detail, "category_names", input.categoryNames);

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.sprint,
        {
            ...input,
            summary: joinSummary([title, input.stateName, input.categoryNames?.join("、")]),
        },
        detail,
    );
}
