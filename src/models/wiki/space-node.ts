import { KG_NODE_KIND, assignDefined, createKgNode, joinSummary, type KgNodeBase } from "../pc-kg-node.js";

export interface SpaceNodeDetail {
    type_name?: string;
}

export interface SpaceKgNode extends KgNodeBase<typeof KG_NODE_KIND.space, SpaceNodeDetail> {}

export interface SpaceNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    typeName?: string;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createSpaceNode(input: SpaceNodeInput): SpaceKgNode {
    const detail: SpaceNodeDetail = {};
    assignDefined(detail, "type_name", input.typeName);

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.space,
        {
            ...input,
            summary: joinSummary([title, input.typeName]),
        },
        detail,
    );
}
