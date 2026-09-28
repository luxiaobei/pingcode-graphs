import { KG_NODE_KIND, assignDefined, createKgNode, joinSummary, type KgNodeBase } from "./pc-kg-node.js";

export interface ReleaseNodeDetail {
    state_name?: string;
    stage_name?: string;
    start_at?: number;
    published_at?: number;
}

export interface ReleaseKgNode extends KgNodeBase<typeof KG_NODE_KIND.release, ReleaseNodeDetail> {}

export interface ReleaseNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    stateName?: string;
    stageName?: string;
    startAt?: number;
    publishedAt?: number;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createReleaseNode(input: ReleaseNodeInput): ReleaseKgNode {
    const detail: ReleaseNodeDetail = {};
    assignDefined(detail, "state_name", input.stateName);
    assignDefined(detail, "stage_name", input.stageName);
    assignDefined(detail, "start_at", input.startAt);
    assignDefined(detail, "published_at", input.publishedAt);

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.release,
        {
            ...input,
            summary: joinSummary([title, input.stateName, input.stageName]),
        },
        detail,
    );
}
