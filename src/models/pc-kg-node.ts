import type { UserKgNode } from "./global/index.js";
import type { IdeaKgNode, TicketKgNode, ProductKgNode } from "./ship/index.js";
import type { PageKgNode, SpaceKgNode } from "./wiki/index.js";
import type { ProjectKgNode, SprintKgNode, ReleaseKgNode, WorkItemKgNode } from "./pjm/index.js";
import type { LibraryKgNode, TestCaseKgNode } from "./testhub/index.js";

export const KG_NODE_KIND = {
    workItem: "work_item",
    testCase: "test_case",
    idea: "idea",
    ticket: "ticket",
    page: "page",
    space: "space",
    project: "project",
    sprint: "sprint",
    release: "release",
    product: "product",
    library: "library",
    user: "user",
} as const;

export type KgNodeKind = (typeof KG_NODE_KIND)[keyof typeof KG_NODE_KIND];

export type KgNode =
    | WorkItemKgNode
    | TestCaseKgNode
    | IdeaKgNode
    | TicketKgNode
    | PageKgNode
    | SpaceKgNode
    | ProjectKgNode
    | SprintKgNode
    | ReleaseKgNode
    | ProductKgNode
    | LibraryKgNode
    | UserKgNode;

const TEXT_EXCERPT_LIMIT = 500;

export interface KgNodeBase<K extends KgNodeKind = KgNodeKind, D = unknown> {
    id: string;
    kind: K;
    ref_id: string;
    name: string;
    identifier?: string;
    summary?: string;
    active?: boolean;
    source_updated_at?: number;
    synced_at?: number;
    detail?: D;
}

export interface KgNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    summary?: string;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function kgNodeId(kind: KgNodeKind, refId: string): string {
    return `${kind}:${refId}`;
}

export function excerptText(text: string | undefined): string | undefined {
    if (!text) {
        return undefined;
    }
    const plain = text.replace(/<[^>]+>/g, "").trim();
    if (!plain) {
        return undefined;
    }
    if (plain.length <= TEXT_EXCERPT_LIMIT) {
        return plain;
    }
    return plain.slice(0, TEXT_EXCERPT_LIMIT);
}

export function createKgNode<K extends KgNodeKind, D>(kind: K, input: KgNodeInput, detail: D): KgNodeBase<K, D> {
    const node: KgNodeBase<K, D> = {
        id: kgNodeId(kind, input.refId),
        kind,
        ref_id: input.refId,
        name: input.name,
        active: input.active ?? true,
        detail,
    };
    assignDefined(node, "identifier", input.identifier);
    assignDefined(node, "summary", input.summary);
    assignDefined(node, "source_updated_at", input.sourceUpdatedAt);
    assignDefined(node, "synced_at", input.syncedAt);
    return node;
}

export function assignDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
    if (value !== undefined) {
        target[key] = value;
    }
}

export function joinSummary(parts: Array<string | undefined>): string {
    return parts.filter((part): part is string => !!part).join("｜");
}
