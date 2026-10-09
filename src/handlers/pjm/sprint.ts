import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createSprintNode, type SprintKgNode, type SprintNodeInput } from "../../models/pjm/sprint-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode } from "../../models/pc-kg-node.js";
import { createKgEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge } from "../../models/pc-kg-edge.js";

function categoryNames(categories: Array<{ name?: string }> | undefined): string[] | undefined {
    if (!categories?.length) {
        return undefined;
    }
    const names = categories.flatMap((category) => (category?.name ? [category.name] : []));
    return names.length > 0 ? names : undefined;
}

function toSprintNode(sprintInfo: any) {
    const input: SprintNodeInput = {
        refId: sprintInfo["id"],
        name: sprintInfo["name"],
        stateName: sprintInfo["status"],
        startAt: sprintInfo["start_at"],
        endAt: sprintInfo["end_at"],
        startedAt: sprintInfo["started_at"],
        completedAt: sprintInfo["completed_at"],
        description: sprintInfo["description"],
        sourceUpdatedAt: sprintInfo["updated_at"],
        syncedAt: sprintInfo["updated_at"],
        active: true,
    };
    const names = categoryNames(sprintInfo["categories"]);
    if (names) {
        input.categoryNames = names;
    }
    return createSprintNode(input);
}

export const onSprintCreatedHandler: EventHandler = async (context, event) => {
    const sprintNode = toSprintNode((event.payload as any)["data"]);
    await ces.entity(KG_NODE_ENTITY_NAME).insert(sprintNode);
    createSprintEdges(sprintNode, (event.payload as any)["data"]);
};

export const onSprintUpdatedHandler: EventHandler = async (context, event) => {
    const sprintNode = toSprintNode((event.payload as any)["data"]);
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(sprintNode.kind);
        cb.field("ref_id").eq(sprintNode.ref_id);
    }, sprintNode);
    createSprintEdges(sprintNode, (event.payload as any)["data"]);
};

export const onSprintDeletedHandler: EventHandler = async (context, event) => {
    const sprintInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.sprint);
        cb.field("ref_id").eq(sprintInfo["id"]);
    }, { active: false });
};

async function createSprintEdges(sprintNode: SprintKgNode, sprintInfo: any) {
    const edges: KgEdge[] = [];
    if (sprintInfo["project"]) {
        edges.push(createKgEdge({
            fromId: sprintNode.id,
            toId: kgNodeId(KG_NODE_KIND.project, sprintInfo["project"]?.["id"]),
            type: KG_EDGE_TYPE.belongsTo,
        }));
        await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).delete((cb) => {
            cb.field("from_id").eq(sprintNode.id);
            cb.field("type").eq(KG_EDGE_TYPE.belongsTo);
        });
    }
    if (sprintInfo["assignee"]) {
        edges.push(createKgEdge({
            fromId: sprintNode.id,
            toId: kgNodeId(KG_NODE_KIND.user, sprintInfo["assignee"]?.["id"]),
            type: KG_EDGE_TYPE.assignedTo,
        }));
        await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).delete((cb) => {
            cb.field("from_id").eq(sprintNode.id);
            cb.field("type").eq(KG_EDGE_TYPE.assignedTo);
        });
    }
    if (edges.length > 0) {
        await ces.entity(KG_EDGE_ENTITY_NAME).insert(edges);
    }
}
