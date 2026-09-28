import { KG_NODE_KIND, assignDefined, createKgNode, joinSummary, type KgNodeBase } from "./pc-kg-node.js";

export type PageNodeDetail = {
    type_name?: string;
};

export interface PageKgNode extends KgNodeBase<typeof KG_NODE_KIND.page, PageNodeDetail> {}

export interface PageNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    typeName?: string;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createPageNode(input: PageNodeInput): PageKgNode {
    const detail: PageNodeDetail = {};
    assignDefined(detail, "type_name", input.typeName);
    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.page,
        {
            ...input,
            summary: joinSummary([title, input.typeName]),
        },
        detail,
    );
}
