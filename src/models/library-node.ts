import { KG_NODE_KIND, assignDefined, createKgNode, excerptText, joinSummary, type KgNodeBase } from "./pc-kg-node.js";

export interface LibraryNodeDetail {
    description_excerpt?: string;
}

export interface LibraryKgNode extends KgNodeBase<typeof KG_NODE_KIND.library, LibraryNodeDetail> {}

export interface LibraryNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    description?: string;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createLibraryNode(input: LibraryNodeInput): LibraryKgNode {
    const detail: LibraryNodeDetail = {};
    assignDefined(detail, "description_excerpt", excerptText(input.description));

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.library,
        {
            ...input,
            summary: joinSummary([title]),
        },
        detail,
    );
}
