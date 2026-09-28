import type { IdeaKgNode } from "./idea-node.js";
import type { LibraryKgNode } from "./library-node.js";
import type { PageKgNode } from "./page-node.js";
import type { ProductKgNode } from "./product-node.js";
import type { ProjectKgNode } from "./project-node.js";
import type { ReleaseKgNode } from "./release-node.js";
import type { SpaceKgNode } from "./space-node.js";
import type { SprintKgNode } from "./sprint-node.js";
import type { TestCaseKgNode } from "./test-case-node.js";
import type { TicketKgNode } from "./ticket-node.js";
import type { WorkItemKgNode } from "./work-item-node.js";

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
    | LibraryKgNode;

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
