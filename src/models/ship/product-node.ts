import { KG_NODE_KIND, assignDefined, createKgNode, excerptText, joinSummary, type KgNodeBase } from "../pc-kg-node.js";

export interface ProductNodeDetail {
    state_name?: string;
    description_excerpt?: string;
}

export interface ProductKgNode extends KgNodeBase<typeof KG_NODE_KIND.product, ProductNodeDetail> {}

export interface ProductNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    stateName?: string;
    description?: string;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createProductNode(input: ProductNodeInput): ProductKgNode {
    const detail: ProductNodeDetail = {};
    assignDefined(detail, "state_name", input.stateName);
    assignDefined(detail, "description_excerpt", excerptText(input.description));

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.product,
        {
            ...input,
            summary: joinSummary([title, input.stateName]),
        },
        detail,
    );
}
