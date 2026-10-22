import { api } from "@pc-nexus/network";
import { ces } from "@pc-nexus/storage";
import { createKgEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge } from "../models/pc-kg-edge.js";
import { assignDefined, KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode, type KgNodeKind } from "../models/pc-kg-node.js";
import { createProjectNode, type ProjectNodeInput } from "../models/pjm/project-node.js";
import { createReleaseNode, type ReleaseNodeInput } from "../models/pjm/release-node.js";
import { createSprintNode, type SprintNodeInput } from "../models/pjm/sprint-node.js";
import { createWorkItemNode, type WorkItemNodeInput } from "../models/pjm/work-item-node.js";
import { createIdeaNode, type IdeaNodeInput } from "../models/ship/idea-node.js";
import { createProductNode, type ProductNodeInput } from "../models/ship/product-node.js";
import { createTicketNode, type TicketNodeInput } from "../models/ship/ticket-node.js";
import { createLibraryNode, type LibraryNodeInput } from "../models/testhub/library-node.js";
import { createTestCaseNode, type TestCaseNodeInput } from "../models/testhub/test-case-node.js";
import { createPageNode, type PageNodeInput } from "../models/wiki/page-node.js";
import { createSpaceNode, type SpaceNodeInput } from "../models/wiki/space-node.js";

const DETAIL_PATH: Partial<Record<KgNodeKind, string>> = {
    [KG_NODE_KIND.workItem]: "/v2/pjm/workitems/",
    [KG_NODE_KIND.idea]: "/v2/ship/ideas/",
    [KG_NODE_KIND.ticket]: "/v2/ship/tickets/",
    [KG_NODE_KIND.testCase]: "/v2/testhub/testcases/",
    [KG_NODE_KIND.page]: "/v2/wiki/pages/",
};

const inflight = new Map<string, Promise<void>>();
const workItemTypeCache = new Map<string, Promise<ApiObject | undefined>>();

/** OpenAPI 详情里实际读取的字段。声明后才能在 noPropertyAccessFromIndexSignature 下用点号访问。 */
interface ApiObject {
    assignee?: any;
    avatar?: any;
    categories?: any;
    channel?: any;
    color?: any;
    completed_at?: any;
    data?: any;
    date?: any;
    description?: any;
    display_name?: any;
    due?: any;
    end_at?: any;
    estimated_at?: any;
    from?: any;
    granularity?: any;
    icon?: any;
    id?: any;
    identifier?: any;
    important_level?: any;
    is_deleted?: any;
    is_local_configure?: any;
    iteration?: any;
    level?: any;
    library?: any;
    name?: any;
    parent?: any;
    parent_id?: any;
    plan_at?: any;
    priority?: any;
    product?: any;
    project?: any;
    properties?: any;
    published_at?: any;
    real_at?: any;
    release?: any;
    releases?: any;
    short_id?: any;
    solution?: any;
    space?: any;
    sprint?: any;
    stage?: any;
    start?: any;
    start_at?: any;
    started_at?: any;
    state?: any;
    status?: any;
    story_points?: any;
    template?: any;
    template_type?: any;
    title?: any;
    to?: any;
    type?: any;
    updated_at?: any;
    value?: any;
    version?: any;
    versions?: any;
    whole_identifier?: any;
}

/**
 * 节点不在库中时，按 OpenAPI 详情补齐这一条及其响应里已经带上的容器。
 * 工作项会同时写入所属项目、迭代、发布，类型图标和颜色另取工作项类型接口。
 */
export function ensureGraphNode(nodeId: string): Promise<void> {
    const current = inflight.get(nodeId);
    if (current) {
        return current;
    }
    const job = ensureGraphNodeOnce(nodeId).finally(() => {
        inflight.delete(nodeId);
    });
    inflight.set(nodeId, job);
    return job;
}

async function ensureGraphNodeOnce(nodeId: string): Promise<void> {
    const parsed = parseNodeId(nodeId);
    if (!parsed) {
        return;
    }
    const path = DETAIL_PATH[parsed.kind];
    if (!path) {
        return;
    }
    if (await findNode(nodeId)) {
        return;
    }
    const detail = await fetchDetail(`${path}${encodeURIComponent(parsed.refId)}`);
    if (!detail) {
        return;
    }
    const seeded = await seedDetail(parsed.kind, detail);
    await insertNodes(seeded.nodes);
    await insertEdges(seeded.edges);
}

async function seedDetail(kind: KgNodeKind, detail: ApiObject): Promise<{ nodes: KgNode[]; edges: KgEdge[] }> {
    if (kind === KG_NODE_KIND.workItem) {
        return seedWorkItem(detail);
    }
    if (kind === KG_NODE_KIND.idea) {
        return seedIdea(detail);
    }
    if (kind === KG_NODE_KIND.ticket) {
        return seedTicket(detail);
    }
    if (kind === KG_NODE_KIND.testCase) {
        return seedTestCase(detail);
    }
    if (kind === KG_NODE_KIND.page) {
        return seedPage(detail);
    }
    return { nodes: [], edges: [] };
}

async function seedWorkItem(detail: ApiObject): Promise<{ nodes: KgNode[]; edges: KgEdge[] }> {
    const refId = stringField(detail.id);
    if (!refId) {
        return { nodes: [], edges: [] };
    }
    const typeRecord = asRecord(detail.type);
    const typeId = stringField(typeRecord?.id);
    const typeInfo = typeId ? await loadWorkItemType(typeId) : undefined;
    const sprint = asRecord(detail.sprint) ?? asRecord(detail.iteration);
    const input: WorkItemNodeInput = {
        refId,
        name: stringField(detail.title) ?? stringField(detail.name) ?? "",
        active: detail.is_deleted !== 1,
    };
    assignDefined(input, "identifier", stringField(detail.whole_identifier) ?? stringField(detail.identifier));
    assignDefined(input, "typeName", stringField(typeInfo?.name) ?? stringField(detail.type) ?? stringField(typeRecord?.name));
    assignDefined(input, "typeIcon", stringField(typeInfo?.icon));
    assignDefined(input, "typeColor", stringField(typeInfo?.color));
    assignDefined(input, "stateType", stringField(asRecord(detail.state)?.type));
    assignDefined(input, "stateName", stringField(asRecord(detail.state)?.name));
    assignDefined(input, "priority", namedText(detail.priority));
    assignDefined(input, "startAt", timestamp(detail.start_at) ?? timestamp(detail.start));
    assignDefined(input, "endAt", timestamp(detail.end_at) ?? timestamp(detail.due));
    assignDefined(input, "description", stringField(detail.description));
    assignDefined(input, "assigneeName", stringField(asRecord(detail.assignee)?.display_name));
    assignDefined(input, "assigneeAvatar", stringField(asRecord(detail.assignee)?.avatar));
    assignDefined(input, "sprintName", stringField(sprint?.name));
    assignDefined(input, "storyPoints", numberField(asRecord(detail.properties)?.story_points));
    assignTimestamps(input, numberField(detail.updated_at));
    const node = createWorkItemNode(input);
    const nodes: KgNode[] = [node];
    const edges: KgEdge[] = [];
    const project = seedProject(detail.project);
    if (project) {
        nodes.push(project);
        edges.push(link(node.id, project.id, KG_EDGE_TYPE.belongsTo));
    }
    const sprintNode = seedSprint(sprint);
    if (sprintNode) {
        nodes.push(sprintNode);
        edges.push(link(node.id, sprintNode.id, KG_EDGE_TYPE.plannedIn));
    }
    for (const release of refList(detail.releases, detail.versions, detail.version, detail.release)) {
        const releaseNode = seedRelease(release);
        if (!releaseNode) {
            continue;
        }
        nodes.push(releaseNode);
        edges.push(link(node.id, releaseNode.id, KG_EDGE_TYPE.releasedIn));
    }
    const assigneeId = stringField(asRecord(detail.assignee)?.id);
    if (assigneeId) {
        edges.push(link(node.id, kgNodeId(KG_NODE_KIND.user, assigneeId), KG_EDGE_TYPE.assignedTo));
    }
    const parentId = stringField(asRecord(detail.parent)?.id) ?? stringField(detail.parent_id);
    if (parentId) {
        edges.push(link(node.id, kgNodeId(KG_NODE_KIND.workItem, parentId), KG_EDGE_TYPE.parentOf));
    }
    return { nodes, edges };
}

function seedProject(value: any): KgNode | undefined {
    const project = asRecord(value);
    const refId = stringField(project?.id);
    if (!project || !refId) {
        return undefined;
    }
    const template = asRecord(project.template);
    const input: ProjectNodeInput = {
        refId,
        name: stringField(project.name) ?? "",
        templateType: stringField(project.template_type) ?? stringField(template?.type) ?? stringField(project.type) ?? "",
        active: project.is_deleted !== 1,
    };
    assignDefined(input, "identifier", stringField(project.identifier));
    assignDefined(input, "stateType", stringField(asRecord(project.state)?.type));
    assignDefined(input, "stateName", stringField(asRecord(project.state)?.name));
    assignDefined(input, "description", stringField(project.description));
    assignDefined(input, "startAt", timestamp(project.start_at) ?? timestamp(project.start));
    assignDefined(input, "endAt", timestamp(project.end_at) ?? timestamp(project.due));
    if (project.is_local_configure !== undefined) {
        input.isLocalConfigure = project.is_local_configure === 1;
    }
    assignTimestamps(input, numberField(project.updated_at));
    return createProjectNode(input);
}

function seedSprint(sprint: ApiObject | undefined): KgNode | undefined {
    const refId = stringField(sprint?.id);
    if (!sprint || !refId) {
        return undefined;
    }
    const input: SprintNodeInput = {
        refId,
        name: stringField(sprint.name) ?? "",
        active: sprint.is_deleted !== 1,
    };
    assignDefined(input, "stateName", stringField(sprint.status) ?? stringField(asRecord(sprint.state)?.name));
    assignDefined(input, "startAt", timestamp(sprint.start_at) ?? timestamp(sprint.start));
    assignDefined(input, "endAt", timestamp(sprint.end_at) ?? timestamp(sprint.due));
    assignDefined(input, "startedAt", timestamp(sprint.started_at));
    assignDefined(input, "completedAt", timestamp(sprint.completed_at));
    assignDefined(input, "description", stringField(sprint.description));
    assignDefined(input, "categoryNames", categoryNames(sprint.categories));
    assignTimestamps(input, numberField(sprint.updated_at));
    return createSprintNode(input);
}

function seedRelease(release: ApiObject): KgNode | undefined {
    const refId = stringField(release.id);
    if (!refId) {
        return undefined;
    }
    const input: ReleaseNodeInput = {
        refId,
        name: stringField(release.name) ?? "",
        active: release.is_deleted !== 1,
    };
    assignDefined(input, "stageName", stringField(asRecord(release.stage)?.name) ?? stringField(asRecord(release.state)?.name));
    assignDefined(input, "startAt", timestamp(release.start_at) ?? timestamp(release.start));
    assignDefined(input, "publishedAt", timestamp(release.published_at));
    assignTimestamps(input, numberField(release.updated_at));
    return createReleaseNode(input);
}

function seedIdea(detail: ApiObject): { nodes: KgNode[]; edges: KgEdge[] } {
    const refId = stringField(detail.id);
    if (!refId) {
        return { nodes: [], edges: [] };
    }
    const input: IdeaNodeInput = {
        refId,
        name: stringField(detail.title) ?? "",
        active: detail.is_deleted !== 1,
    };
    assignDefined(input, "identifier", stringField(detail.whole_identifier) ?? stringField(detail.identifier));
    assignDefined(input, "stateType", stringField(asRecord(detail.state)?.type));
    assignDefined(input, "stateName", stringField(asRecord(detail.state)?.name));
    assignDefined(input, "description", stringField(detail.description));
    assignDefined(input, "priority", namedText(detail.priority));
    assignDefined(input, "planDateBeginAt", spanPoint(detail.plan_at, "from"));
    assignDefined(input, "planDateEndAt", spanPoint(detail.plan_at, "to"));
    assignDefined(input, "planDateGranularity", stringField(asRecord(detail.plan_at)?.granularity));
    assignDefined(input, "realDateBeginAt", spanPoint(detail.real_at, "from"));
    assignDefined(input, "realDateEndAt", spanPoint(detail.real_at, "to"));
    assignDefined(input, "realDateGranularity", stringField(asRecord(detail.real_at)?.granularity));
    assignDefined(input, "assigneeName", stringField(asRecord(detail.assignee)?.display_name));
    assignDefined(input, "assigneeAvatar", stringField(asRecord(detail.assignee)?.avatar));
    assignTimestamps(input, numberField(detail.updated_at));
    const node = createIdeaNode(input);
    return withContainer(node, seedProduct(detail.product), detail.assignee);
}

function seedTicket(detail: ApiObject): { nodes: KgNode[]; edges: KgEdge[] } {
    const refId = stringField(detail.id);
    if (!refId) {
        return { nodes: [], edges: [] };
    }
    const input: TicketNodeInput = {
        refId,
        name: stringField(detail.title) ?? "",
        active: detail.is_deleted !== 1,
    };
    assignDefined(input, "identifier", stringField(detail.whole_identifier) ?? stringField(detail.identifier));
    assignDefined(input, "stateType", stringField(asRecord(detail.state)?.type));
    assignDefined(input, "stateName", stringField(asRecord(detail.state)?.name));
    assignDefined(input, "description", stringField(detail.description));
    assignDefined(input, "priority", namedText(detail.priority));
    assignDefined(input, "solution", namedText(detail.solution));
    assignDefined(input, "channel", channelLabel(detail.channel));
    assignDefined(input, "estimatedAt", spanPoint(detail.estimated_at, "to"));
    assignDefined(input, "typeName", namedText(detail.type));
    assignDefined(input, "assigneeName", stringField(asRecord(detail.assignee)?.display_name));
    assignDefined(input, "assigneeAvatar", stringField(asRecord(detail.assignee)?.avatar));
    assignTimestamps(input, numberField(detail.updated_at));
    const node = createTicketNode(input);
    return withContainer(node, seedProduct(detail.product), detail.assignee);
}

function seedTestCase(detail: ApiObject): { nodes: KgNode[]; edges: KgEdge[] } {
    const refId = stringField(detail.id);
    if (!refId) {
        return { nodes: [], edges: [] };
    }
    const input: TestCaseNodeInput = {
        refId,
        name: stringField(detail.title) ?? "",
        active: detail.is_deleted !== 1,
    };
    assignDefined(input, "identifier", stringField(detail.whole_identifier) ?? stringField(detail.identifier));
    assignDefined(input, "typeName", namedText(detail.type));
    assignDefined(input, "level", namedText(detail.important_level) ?? stringField(detail.level));
    assignDefined(input, "stateType", stringField(asRecord(detail.state)?.type));
    assignDefined(input, "stateName", stringField(asRecord(detail.state)?.name));
    assignDefined(input, "description", stringField(detail.description));
    assignTimestamps(input, numberField(detail.updated_at));
    const node = createTestCaseNode(input);
    return withContainer(node, seedLibrary(detail.library));
}

function seedPage(detail: ApiObject): { nodes: KgNode[]; edges: KgEdge[] } {
    const refId = stringField(detail.id);
    if (!refId) {
        return { nodes: [], edges: [] };
    }
    const input: PageNodeInput = {
        refId,
        name: stringField(detail.name) ?? "",
        active: detail.is_deleted !== 1,
    };
    assignDefined(input, "identifier", stringField(detail.short_id) ?? stringField(detail.identifier));
    assignDefined(input, "typeName", stringField(detail.type));
    assignTimestamps(input, numberField(detail.updated_at));
    const node = createPageNode(input);
    return withContainer(node, seedSpace(detail.space));
}

function seedProduct(value: any): KgNode | undefined {
    const product = asRecord(value);
    const refId = stringField(product?.id);
    if (!product || !refId) {
        return undefined;
    }
    const input: ProductNodeInput = {
        refId,
        name: stringField(product.name) ?? "",
        active: product.is_deleted !== 1,
    };
    assignDefined(input, "identifier", stringField(product.identifier));
    assignDefined(input, "description", stringField(product.description));
    assignTimestamps(input, numberField(product.updated_at));
    return createProductNode(input);
}

function seedLibrary(value: any): KgNode | undefined {
    const library = asRecord(value);
    const refId = stringField(library?.id);
    if (!library || !refId) {
        return undefined;
    }
    const input: LibraryNodeInput = {
        refId,
        name: stringField(library.name) ?? "",
        active: library.is_deleted !== 1,
    };
    assignDefined(input, "identifier", stringField(library.identifier));
    assignDefined(input, "description", stringField(library.description));
    assignTimestamps(input, numberField(library.updated_at));
    return createLibraryNode(input);
}

function seedSpace(value: any): KgNode | undefined {
    const space = asRecord(value);
    const refId = stringField(space?.id);
    if (!space || !refId) {
        return undefined;
    }
    const input: SpaceNodeInput = {
        refId,
        name: stringField(space.name) ?? "",
        active: space.is_deleted !== 1,
    };
    assignDefined(input, "identifier", stringField(space.identifier));
    assignDefined(input, "typeName", stringField(space.type));
    assignTimestamps(input, numberField(space.updated_at));
    return createSpaceNode(input);
}

function withContainer(node: KgNode, container: KgNode | undefined, assignee?: any): { nodes: KgNode[]; edges: KgEdge[] } {
    const nodes: KgNode[] = [node];
    const edges: KgEdge[] = [];
    if (container) {
        nodes.push(container);
        edges.push(link(node.id, container.id, KG_EDGE_TYPE.belongsTo));
    }
    const assigneeId = stringField(asRecord(assignee)?.id);
    if (assigneeId) {
        edges.push(link(node.id, kgNodeId(KG_NODE_KIND.user, assigneeId), KG_EDGE_TYPE.assignedTo));
    }
    return { nodes, edges };
}

function link(fromId: string, toId: string, type: KgEdge["type"]): KgEdge {
    return createKgEdge({ fromId, toId, type });
}

function loadWorkItemType(typeId: string): Promise<ApiObject | undefined> {
    const current = workItemTypeCache.get(typeId);
    if (current) {
        return current;
    }
    const job = fetchDetail(`/v2/pjm/workitem_types/${encodeURIComponent(typeId)}`).catch((error: unknown) => {
        workItemTypeCache.delete(typeId);
        throw error;
    });
    workItemTypeCache.set(typeId, job);
    return job;
}

async function fetchDetail(path: string): Promise<ApiObject | undefined> {
    const response = await api.invoke(path);
    if (response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || `Failed to load ${path}`);
    }
    const data = asRecord(await response.json());
    const nested = asRecord(data?.data) ?? asRecord(data?.value);
    const detail = stringField(data?.id) ? data : nested;
    return stringField(detail?.id) ? detail : undefined;
}

async function insertNodes(nodes: KgNode[]): Promise<void> {
    const unique = dedupe(nodes, (node) => node.id);
    if (unique.length === 0) {
        return;
    }
    const existing = await findNodes(unique.map((node) => node.id));
    const have = new Set(existing.map((node) => node.id));
    const fresh = unique.filter((node) => !have.has(node.id));
    if (fresh.length === 0) {
        return;
    }
    await ces.entity(KG_NODE_ENTITY_NAME).insert(fresh);
}

async function insertEdges(edges: KgEdge[]): Promise<void> {
    const unique = dedupe(edges, (edge) => edge.id).filter((edge) => edge.from_id !== edge.to_id);
    if (unique.length === 0) {
        return;
    }
    const existing = await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).find((cb) => {
        if (unique.length === 1) {
            cb.field("id").eq(unique[0]!.id);
            return;
        }
        cb.or((or) => {
            for (const edge of unique) {
                or.field("id").eq(edge.id);
            }
        });
    });
    const have = new Set(existing.map((edge) => edge.id));
    const fresh = unique.filter((edge) => !have.has(edge.id));
    if (fresh.length === 0) {
        return;
    }
    await ces.entity(KG_EDGE_ENTITY_NAME).insert(fresh);
}

async function findNode(nodeId: string): Promise<KgNode | undefined> {
    const found = await findNodes([nodeId]);
    return found[0];
}

async function findNodes(ids: string[]): Promise<KgNode[]> {
    if (ids.length === 0) {
        return [];
    }
    if (ids.length === 1) {
        return ces.entity<KgNode>(KG_NODE_ENTITY_NAME).find((cb) => {
            cb.field("id").eq(ids[0]!);
        });
    }
    return ces.entity<KgNode>(KG_NODE_ENTITY_NAME).find((cb) => {
        cb.or((or) => {
            for (const id of ids) {
                or.field("id").eq(id);
            }
        });
    });
}

function parseNodeId(nodeId: string): { kind: KgNodeKind; refId: string } | undefined {
    const separator = nodeId.indexOf(":");
    if (separator <= 0 || separator !== nodeId.lastIndexOf(":")) {
        return undefined;
    }
    const kind = nodeId.slice(0, separator);
    const refId = nodeId.slice(separator + 1);
    if (!refId || !Object.values(KG_NODE_KIND).includes(kind as KgNodeKind)) {
        return undefined;
    }
    return { kind: kind as KgNodeKind, refId };
}

function dedupe<T>(items: T[], idOf: (item: T) => string): T[] {
    const seen = new Set<string>();
    const unique: T[] = [];
    for (const item of items) {
        const id = idOf(item);
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        unique.push(item);
    }
    return unique;
}

function refList(...values: any[]): Array<ApiObject> {
    const refs: Array<ApiObject> = [];
    const seen = new Set<string>();
    for (const value of values) {
        const items = Array.isArray(value) ? value : value ? [value] : [];
        for (const item of items) {
            const record = asRecord(item);
            const id = stringField(record?.id);
            if (!record || !id || seen.has(id)) {
                continue;
            }
            seen.add(id);
            refs.push(record);
        }
    }
    return refs;
}

function categoryNames(value: any): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const names = value.flatMap((item) => {
        const name = stringField(asRecord(item)?.name);
        return name ? [name] : [];
    });
    return names.length > 0 ? names : undefined;
}

function spanPoint(value: any, side: "from" | "to"): number | undefined {
    return timestamp(asRecord(value)?.[side]);
}

function channelLabel(value: any): string | undefined {
    if (typeof value === "string") {
        return value || undefined;
    }
    return stringField(asRecord(value)?.name);
}

function namedText(value: any): string | undefined {
    if (typeof value === "string") {
        return value || undefined;
    }
    return stringField(asRecord(value)?.name);
}

function timestamp(value: any): number | undefined {
    if (typeof value === "number") {
        return value;
    }
    return numberField(asRecord(value)?.date);
}

function assignTimestamps(input: { sourceUpdatedAt?: number; syncedAt?: number }, updatedAt: number | undefined): void {
    if (updatedAt !== undefined) {
        input.sourceUpdatedAt = updatedAt;
        input.syncedAt = updatedAt;
        return;
    }
    input.syncedAt = Math.floor(Date.now() / 1000);
}

function stringField(value: any): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function numberField(value: any): number | undefined {
    return typeof value === "number" ? value : undefined;
}

function asRecord(value: any): ApiObject | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value as ApiObject;
}
