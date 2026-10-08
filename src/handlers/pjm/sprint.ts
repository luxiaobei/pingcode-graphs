import type { EventHandler } from "@pc-nexus/event";
import { ces } from "@pc-nexus/storage";
import { createSprintNode, type SprintNodeInput } from "../../models/pjm/sprint-node.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, type KgNode } from "../../models/pc-kg-node.js";

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
};

export const onSprintUpdatedHandler: EventHandler = async (context, event) => {
    const sprintNode = toSprintNode((event.payload as any)["data"]);
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(sprintNode.kind);
        cb.field("ref_id").eq(sprintNode.ref_id);
    }, sprintNode);
};

export const onSprintDeletedHandler: EventHandler = async (context, event) => {
    const sprintInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(KG_NODE_KIND.sprint);
        cb.field("ref_id").eq(sprintInfo["id"]);
    }, { active: false });
};
