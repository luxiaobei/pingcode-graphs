import type { NexusAppContext } from "@pc-nexus/core";
import { api } from "@pc-nexus/network";
import type { GraphWorkItem, RelationType } from "../types/graph.js";

interface ListResponse<T> {
    values?: T[];
    page_size?: number;
    page_index?: number;
    total?: number;
}

export interface WorkItemRelation {
    id?: string;
    relation_type?: RelationType | string;
    target_work_item_id?: string;
    work_item?: GraphWorkItem;
    target_work_item?: GraphWorkItem;
}

type ApiResponse = Awaited<ReturnType<typeof api.invoke>>;

async function readJsonResponse<T>(response: ApiResponse, errorMessage: string): Promise<T> {
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || errorMessage);
    }
    return (await response.json()) as T;
}

function restApiOptions(context: Pick<NexusAppContext, "user">) {
    const options: { as: "user"; userId?: string } = { as: "user" };
    if (context.user?.id) {
        options.userId = context.user.id;
    }
    return options;
}

export class WorkItemService {
    async fetchWorkItem(
        context: Pick<NexusAppContext, "user">,
        workitemId: string,
    ): Promise<GraphWorkItem> {
        const response = await api.invoke(
            `/v1/project/work_items/${workitemId}`,
            restApiOptions(context),
        );
        return readJsonResponse<GraphWorkItem>(response, `Work item not found: ${workitemId}`);
    }

    async fetchRelations(
        context: Pick<NexusAppContext, "user">,
        workitemId: string,
        relationType?: RelationType,
    ): Promise<WorkItemRelation[]> {
        const params = new URLSearchParams();
        if (relationType) {
            params.set("relation_type", relationType);
        }
        const query = params.toString();
        const path = `/v1/project/work_items/${workitemId}/relations${query ? `?${query}` : ""}`;
        const response = await api.invoke(path, restApiOptions(context));
        const data = await readJsonResponse<ListResponse<WorkItemRelation> | WorkItemRelation[]>(
            response,
            `Failed to load relations: ${workitemId}`,
        );
        if (Array.isArray(data)) {
            return data;
        }
        return data.values ?? [];
    }
}

export const workItemService = new WorkItemService();
