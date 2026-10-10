import type { EventHandler } from "@pc-nexus/event";
import { createWorkItemNode, type WorkItemKgNode } from "../../models/pjm/work-item-node.js";
import { ces } from "@pc-nexus/storage";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode } from "../../models/pc-kg-node.js";
import { createKgEdge, deleteEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge, type KgEdgeType } from "../../models/pc-kg-edge.js";
import { api } from "@pc-nexus/network";

const edgeTypeMap: Record<string, KgEdgeType> = {
    "assignee": KG_EDGE_TYPE.assignedTo,
    "iteration": KG_EDGE_TYPE.plannedIn,
    "version": KG_EDGE_TYPE.releasedIn,
    "parent_id": KG_EDGE_TYPE.parentOf,
};

export const onWorkItemCreatedHandler: EventHandler = async (context, event) => {
    const workitemInfo = (event.payload as any)["data"];
    const typeId = workitemInfo["type"];
    const typeRes = await api.invoke(`/v1/pjm/workitem_types/${typeId}`);
    const typeInfo = await typeRes.json();
    const workitemNode = createWorkItemNode({
        refId: workitemInfo["id"],
        name: workitemInfo["title"],
        identifier: workitemInfo["identifier"],
        typeName: typeInfo["name"],
        typeIcon: typeInfo["icon"],
        typeColor: typeInfo["color"],
        stateType: workitemInfo["state"]["type"],
        stateName: workitemInfo["state"]["name"],
        priority: workitemInfo["priority"]["name"],
        startAt: workitemInfo["start_at"],
        endAt: workitemInfo["end_at"],
        description: workitemInfo["description"],
        assigneeName: workitemInfo["assignee"]["name"],
        assigneeAvatar: workitemInfo["assignee"]?.["avatar"],
        sprintName: workitemInfo["sprint"]["name"],
        sourceUpdatedAt: workitemInfo["updated_at"],
        syncedAt: workitemInfo["updated_at"],
        active: true,
        storyPoints: workitemInfo["properties"]["story_points"],
    });
    await ces.entity(KG_NODE_ENTITY_NAME).insert(workitemNode);
    createWorkItemEdges(workitemNode, workitemInfo);
};

export const onWorkItemUpdatedHandler: EventHandler = async (context, event) => {
    const workitemInfo = (event.payload as any)["data"];
    const typeId = workitemInfo["type"];
    const typeRes = await api.invoke(`/v1/pjm/workitem_types/${typeId}`);
    const typeInfo = await typeRes.json();
    const workitemNode = createWorkItemNode({
        refId: workitemInfo["id"],
        name: workitemInfo["title"],
        identifier: workitemInfo["identifier"],
        typeName: typeInfo["name"],
        typeIcon: typeInfo["icon"],
        typeColor: typeInfo["color"],
        stateType: workitemInfo["state"]["type"],
        stateName: workitemInfo["state"]["name"],
        priority: workitemInfo["priority"]["name"],
        startAt: workitemInfo["start_at"],
        endAt: workitemInfo["end_at"],
        description: workitemInfo["description"],
        assigneeName: workitemInfo["assignee"]["name"],
        assigneeAvatar: workitemInfo["assignee"]?.["avatar"],
        sprintName: workitemInfo["sprint"]["name"],
        sourceUpdatedAt: workitemInfo["updated_at"],
        syncedAt: workitemInfo["updated_at"],
        active: true,
        storyPoints: workitemInfo["properties"]["story_points"],
    });
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
        cb.field("kind").eq(workitemNode.kind);
        cb.field("ref_id").eq(workitemNode.ref_id);
    }, workitemNode);
    if (["assignee", "iteration", "version", "parent_id"].includes((event.payload as any).changelog.property.id)) {
        createWorkItemEdges(workitemNode, workitemInfo);
        if ((event.payload as any).changelog.target === null) {
            deleteEdge(workitemNode.id, edgeTypeMap[(event.payload as any).changelog.property.id] as KgEdgeType);
        }
    }
};

export const onWorkItemDeletedHandler: EventHandler = async (context, event) => {
    const workitemInfo = (event.payload as any)["data"];
    await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb => {
        cb.field("ref_id").eq(workitemInfo["id"]);
    }), { active: false });
};

async function createWorkItemEdges(workitemNode: WorkItemKgNode, workitemInfo: any) {
    const edges: KgEdge[] = [];
    if (workitemInfo["project"]) {
        edges.push(createKgEdge({
            fromId: workitemNode.id,
            toId: kgNodeId(KG_NODE_KIND.project, workitemInfo["project"]?.["id"]),
            type: KG_EDGE_TYPE.belongsTo,
        }));
        deleteEdge(workitemNode.id, KG_EDGE_TYPE.belongsTo);
    }
    if (workitemInfo["assignee"]) {
        edges.push(createKgEdge({
            fromId: workitemNode.id,
            toId: kgNodeId(KG_NODE_KIND.user, workitemInfo["assignee"]?.["id"]),
            type: KG_EDGE_TYPE.assignedTo,
        }));
        deleteEdge(workitemNode.id, KG_EDGE_TYPE.assignedTo);
    }
    if (workitemInfo["sprint"]) {
        edges.push(createKgEdge({
            fromId: workitemNode.id,
            toId: kgNodeId(KG_NODE_KIND.sprint, workitemInfo["sprint"]?.["id"]),
            type: KG_EDGE_TYPE.plannedIn,
        }));
        deleteEdge(workitemNode.id, KG_EDGE_TYPE.plannedIn);
    }
    if (workitemInfo["releases"]) {
        for (const release of workitemInfo["releases"]) {
            edges.push(createKgEdge({
                fromId: workitemNode.id,
                toId: kgNodeId(KG_NODE_KIND.release, release?.["id"]),
                type: KG_EDGE_TYPE.releasedIn,
            }));
        }
        deleteEdge(workitemNode.id, KG_EDGE_TYPE.releasedIn);
    }
    if (workitemInfo["parent"]) {
        edges.push(createKgEdge({
            fromId: workitemNode.id,
            toId: kgNodeId(KG_NODE_KIND.workItem, workitemInfo["parent"]?.["id"]),
            type: KG_EDGE_TYPE.parentOf,
        }));
        deleteEdge(workitemNode.id, KG_EDGE_TYPE.parentOf);
    }
    if (edges.length > 0) {
        await ces.entity(KG_EDGE_ENTITY_NAME).insert(edges);
    }
}

