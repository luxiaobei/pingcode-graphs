import { KG_NODE_KIND, assignDefined, createKgNode, excerptText, joinSummary, type KgNodeBase } from "../pc-kg-node.js";

export interface ProjectNodeDetail {
    template_type: string;
    state_type?: string;
    state_name?: string;
    description_excerpt?: string;
    start_at?: number;
    end_at?: number;
    is_local_configure?: boolean;
}

export interface ProjectKgNode extends KgNodeBase<typeof KG_NODE_KIND.project, ProjectNodeDetail> {}

export interface ProjectNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    templateType: string;
    stateType?: string;
    stateName?: string;
    description?: string;
    startAt?: number;
    endAt?: number;
    isLocalConfigure?: boolean;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createProjectNode(input: ProjectNodeInput): ProjectKgNode {
    const detail: ProjectNodeDetail = {
        template_type: input.templateType,
    };
    assignDefined(detail, "state_type", input.stateType);
    assignDefined(detail, "state_name", input.stateName);
    assignDefined(detail, "description_excerpt", excerptText(input.description));
    assignDefined(detail, "start_at", input.startAt);
    assignDefined(detail, "end_at", input.endAt);
    assignDefined(detail, "is_local_configure", input.isLocalConfigure);

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.project,
        {
            ...input,
            summary: joinSummary([title, input.templateType, input.stateName]),
        },
        detail,
    );
}
