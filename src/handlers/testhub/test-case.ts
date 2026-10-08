import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createTestCaseNode } from "../../models/testhub/test-case-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, type KgNode } from "../../models/pc-kg-node.js";

export const onTestCaseCreatedHandler: EventHandler = async (context, event) => {
    const testCaseInfo = (event.payload as any)["data"];
    const testCaseNode = createTestCaseNode({
        refId: testCaseInfo["id"],
        name: testCaseInfo["title"],
        identifier: testCaseInfo["identifier"],
        typeName: testCaseInfo["type"]?.["name"],
        level: testCaseInfo["level"],
        stateType: testCaseInfo["state"]?.["type"],
        stateName: testCaseInfo["state"]?.["name"],
        description: testCaseInfo["description"],
        sourceUpdatedAt: testCaseInfo["updated_at"],
        syncedAt: testCaseInfo["updated_at"],
        active: true,
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(testCaseNode);
};

export const onTestCaseUpdatedHandler: EventHandler = async (context, event) => {
    const testCaseInfo = (event.payload as any)["data"];
    const testCaseNode = createTestCaseNode({
        refId: testCaseInfo["id"],
        name: testCaseInfo["title"],
        identifier: testCaseInfo["identifier"],
        typeName: testCaseInfo["type"]?.["name"],
        level: testCaseInfo["level"],
        stateType: testCaseInfo["state"]?.["type"],
        stateName: testCaseInfo["state"]?.["name"],
        description: testCaseInfo["description"],
        sourceUpdatedAt: testCaseInfo["updated_at"],
        syncedAt: testCaseInfo["updated_at"],
        active: true,
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(testCaseNode.kind);
        cb.field("ref_id").eq(testCaseNode.ref_id);
    }, testCaseNode);
};

export const onTestCaseDeletedHandler: EventHandler = async (context, event) => {
    const testCaseInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.testCase);
        cb.field("ref_id").eq(testCaseInfo["id"]);
    }, { active: false });
};
