import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createTestCaseNode, type TestCaseKgNode } from "../../models/testhub/test-case-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode } from "../../models/pc-kg-node.js";
import { createKgEdge, deleteEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge } from "../../models/pc-kg-edge.js";

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
    createTestCaseEdges(testCaseNode, testCaseInfo);
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

async function createTestCaseEdges(testCaseNode: TestCaseKgNode, testCaseInfo: any) {
    const edges: KgEdge[] = [];
    if (testCaseInfo["library"]) {
        edges.push(createKgEdge({
            fromId: testCaseNode.id,
            toId: kgNodeId(KG_NODE_KIND.library, testCaseInfo["library"]?.["id"]),
            type: KG_EDGE_TYPE.belongsTo,
        }));
        await deleteEdge(testCaseNode.id, KG_EDGE_TYPE.belongsTo);
    }
    if (edges.length > 0) {
        await ces.entity(KG_EDGE_ENTITY_NAME).insert(edges);
    }
}
