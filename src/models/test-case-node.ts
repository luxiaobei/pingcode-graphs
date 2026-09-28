import { KG_NODE_KIND, assignDefined, createKgNode, excerptText, joinSummary, type KgNodeBase } from "./pc-kg-node.js";

/** 维护人、所属模块是独立节点，不放在 detail 里。 */
export interface TestCaseNodeDetail {
    type_name?: string;
    level?: string;
    state_type?: string;
    state_name?: string;
    description_excerpt?: string;
}

export interface TestCaseKgNode extends KgNodeBase<typeof KG_NODE_KIND.testCase, TestCaseNodeDetail> {}

export interface TestCaseNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    typeName?: string;
    level?: string;
    stateType?: string;
    stateName?: string;
    description?: string;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createTestCaseNode(input: TestCaseNodeInput): TestCaseKgNode {
    const detail: TestCaseNodeDetail = {};
    assignDefined(detail, "type_name", input.typeName);
    assignDefined(detail, "level", input.level);
    assignDefined(detail, "state_type", input.stateType);
    assignDefined(detail, "state_name", input.stateName);
    assignDefined(detail, "description_excerpt", excerptText(input.description));

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.testCase,
        {
            ...input,
            summary: joinSummary([title, input.typeName, input.level, input.stateType, input.stateName]),
        },
        detail,
    );
}
