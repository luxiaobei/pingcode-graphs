import type { NexusAppContext } from "@pc-nexus/core";
import { api } from "@pc-nexus/network";
import type { GraphWorkItem, RelationType } from "../types/graph.js";

interface ListResponse<T> {
    values?: T[];
    page_size?: number;
    page_index?: number;
    total?: number;
}

export interface WorkItemRelationType {
    id?: string;
    name?: string;
    key?: string;
    /** 稳定类型码，如 relate、clone、cloned_by。 */
    category?: string;
}

export interface WorkItemRelation {
    id?: string;
    /** 公开接口可能是字符串、类型对象，或 null。 */
    relation_type?: RelationType | string | WorkItemRelationType | null;
    origin_work_item_id?: string;
    target_work_item_id?: string;
    work_item?: GraphWorkItem;
    origin_work_item?: GraphWorkItem;
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

const RELATION_PAGE_SIZE = 100;
const MAX_RELATION_PAGES = 50;

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
    ): Promise<WorkItemRelation[]> {
        const collected: WorkItemRelation[] = [];
        const seen = new Set<string>();

        const append = (items: WorkItemRelation[]): number => {
            const sizeBefore = collected.length;
            for (const item of items) {
                if (item.id && seen.has(item.id)) {
                    continue;
                }
                if (item.id) {
                    seen.add(item.id);
                }
                collected.push(item);
            }
            return collected.length - sizeBefore;
        };

        for (let pageIndex = 0; pageIndex < MAX_RELATION_PAGES; pageIndex += 1) {
            const params = new URLSearchParams({
                page_size: String(RELATION_PAGE_SIZE),
                page_index: String(pageIndex),
            });
            const path = `/v1/project/work_items/${workitemId}/relations?${params}`;
            const response = await api.invoke(path, restApiOptions(context));
            const data = await readJsonResponse<ListResponse<WorkItemRelation> | WorkItemRelation[]>(
                response,
                `Failed to load relations: ${workitemId}`,
            );
            if (Array.isArray(data)) {
                const added = append(data);
                if (data.length < RELATION_PAGE_SIZE || added === 0) {
                    break;
                }
                continue;
            }

            const values = data.values ?? [];
            const added = append(values);
            const pageSize = data.page_size ?? RELATION_PAGE_SIZE;
            if (
                values.length === 0 ||
                added === 0 ||
                values.length < pageSize ||
                (typeof data.total === "number" && collected.length >= data.total)
            ) {
                break;
            }
        }

        return collected;
    }
}

export const workItemService = new WorkItemService();
