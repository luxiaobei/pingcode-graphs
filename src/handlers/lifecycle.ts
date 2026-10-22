import type { EventHandler } from "@pc-nexus/event";
import { api } from "@pc-nexus/network";
import { ces } from "@pc-nexus/storage";
import { createUserNode } from "../models/global/user-node.js";
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

const PAGE_SIZE = 100;

interface PagedValues<T> {
    page_size?: number;
    page_index?: number;
    total?: number;
    values?: T[];
}

interface DatePoint {
    date?: number;
}

interface UserBrief {
    id?: string;
    display_name?: string;
    avatar?: string;
}

interface NamedRef {
    id?: string;
    name?: string;
    type?: string;
}

interface DirectoryUser {
    id?: string;
    name?: string;
    display_name?: string;
    email?: string;
    mobile?: string;
    status?: string;
    employee_number?: string;
    gender?: number;
    short_code?: string;
    job?: {
        name?: string;
    };
}

interface ProjectResource {
    id?: string;
    name?: string;
    identifier?: string;
    template_type?: string;
    template?: { type?: string };
    description?: string;
    state?: NamedRef;
    assignee?: UserBrief;
    start?: DatePoint | null;
    due?: DatePoint | null;
    is_local_configure?: number;
    updated_at?: number;
    is_deleted?: number;
}

interface SprintResource {
    id?: string;
    name?: string;
    status?: string;
    project?: NamedRef;
    assignee?: UserBrief;
    start?: DatePoint | null;
    due?: DatePoint | null;
    started_at?: number | null;
    completed_at?: number | null;
    description?: string;
    categories?: Array<{ name?: string }>;
    updated_at?: number;
    is_deleted?: number;
}

interface ReleaseResource {
    id?: string;
    name?: string;
    project?: NamedRef;
    assignee?: UserBrief;
    start?: DatePoint | null;
    published_at?: DatePoint | number | null;
    stage?: NamedRef;
    updated_at?: number;
    is_deleted?: number;
}

interface WorkItemTypeResource {
    id?: string;
    name?: string;
    icon?: string;
    color?: string;
}

interface WorkItemResource {
    id?: string;
    title?: string;
    whole_identifier?: string;
    project?: NamedRef;
    type?: NamedRef;
    start?: DatePoint | null;
    due?: DatePoint | null;
    parent_id?: string | null;
    parent?: { id?: string } | null;
    assignee?: UserBrief;
    releases?: Array<{ id?: string }>;
    sprint?: NamedRef | null;
    state?: NamedRef;
    priority?: NamedRef;
    description?: string;
    properties?: { story_points?: number | null };
    updated_at?: number;
    is_deleted?: number;
}

interface DateSpan {
    from?: DatePoint | number | null;
    to?: DatePoint | number | null;
    granularity?: string;
}

interface NamedContainer {
    id?: string;
    name?: string;
    identifier?: string;
    description?: string;
    updated_at?: number;
    is_deleted?: number;
}

interface IdeaResource {
    id?: string;
    title?: string;
    whole_identifier?: string;
    product?: NamedRef;
    assignee?: UserBrief;
    state?: NamedRef;
    priority?: NamedRef;
    plan_at?: DateSpan | null;
    real_at?: DateSpan | null;
    description?: string;
    updated_at?: number;
    is_deleted?: number;
}

interface TicketResource {
    id?: string;
    title?: string;
    whole_identifier?: string;
    product?: NamedRef;
    assignee?: UserBrief;
    state?: NamedRef;
    priority?: NamedRef;
    solution?: NamedRef;
    type?: NamedRef;
    channel?: { name?: string } | string | null;
    estimated_at?: DateSpan | null;
    description?: string;
    updated_at?: number;
    is_deleted?: number;
}

interface TestCaseResource {
    id?: string;
    title?: string;
    whole_identifier?: string;
    library?: NamedRef;
    important_level?: NamedRef;
    state?: NamedRef;
    type?: NamedRef;
    description?: string;
    updated_at?: number;
    is_deleted?: number;
}

interface PageResource {
    id?: string;
    name?: string;
    short_id?: string;
    type?: string;
    space?: NamedRef;
    updated_at?: number;
    is_deleted?: number;
}

export const onAppInstalledHandler: EventHandler = async () => {
    console.log("🔄 初始化数据开始...");
    await syncDirectoryUsers();
    const projectIds = await syncProjects();
    await syncSprints(projectIds);
    await syncReleases(projectIds);
    await syncWorkItems();
    await syncProducts();
    await syncIdeas();
    await syncTickets();
    await syncLibraries();
    await syncTestCases();
    await syncSpaces();
    await syncPages();
    console.log("✅ 初始化数据完成");
};

async function syncDirectoryUsers(): Promise<void> {
    const users = await listAll<DirectoryUser>("/v2/directory/users", "Failed to load directory users");
    const nodes = users.map((user) => createUserNode({
        refId: user.id,
        name: user.name ?? "",
        ...(user.name ? { identifier: user.name } : {}),
        displayName: user.display_name ?? "",
        employeeNumber: user.employee_number ?? "",
        email: user.email ?? "",
        mobile: user.mobile ?? "",
        title: user.job?.name ?? "",
        gender: user.gender ?? 0,
        status: user.status ?? "",
        shortCode: user.short_code ?? "",
        syncedAt: Math.floor(Date.now() / 1000),
        active: user.status !== "disabled",
    }));
    await saveNodes(nodes, "用户节点");
}

async function syncProjects(): Promise<string[]> {
    const projects = await listAll<ProjectResource>("/v2/pjm/projects", "Failed to load projects");
    const nodes: KgNode[] = [];
    const edges: KgEdge[] = [];
    for (const project of projects) {
        const node = createProjectNode(toProjectInput(project));
        nodes.push(node);
        edges.push(...belongsToUser(node.id, project.assignee?.id));
    }
    await saveGraph(nodes, edges, "项目节点");
    return projects.map((project) => project.id);
}

async function syncSprints(projectIds: string[]): Promise<void> {
    const nodes: KgNode[] = [];
    const edges: KgEdge[] = [];
    for (const projectId of projectIds) {
        const sprints = await listAll<SprintResource>(
            `/v2/pjm/sprints?project_id=${encodeURIComponent(projectId)}`,
            "Failed to load sprints",
        );
        for (const sprint of sprints) {
            const node = createSprintNode(toSprintInput(sprint));
            nodes.push(node);
            edges.push(
                ...linkTo(node.id, KG_NODE_KIND.project, sprint.project?.id ?? projectId, KG_EDGE_TYPE.belongsTo),
                ...belongsToUser(node.id, sprint.assignee?.id),
            );
        }
    }
    await saveGraph(nodes, edges, "迭代节点");
}

async function syncReleases(projectIds: string[]): Promise<void> {
    const nodes: KgNode[] = [];
    const edges: KgEdge[] = [];
    for (const projectId of projectIds) {
        const releases = await listAll<ReleaseResource>(
            `/v2/pjm/releases?project_id=${encodeURIComponent(projectId)}`,
            "Failed to load releases",
        );
        for (const release of releases) {
            const node = createReleaseNode(toReleaseInput(release));
            nodes.push(node);
            edges.push(
                ...linkTo(node.id, KG_NODE_KIND.project, release.project?.id ?? projectId, KG_EDGE_TYPE.belongsTo),
                ...belongsToUser(node.id, release.assignee?.id),
            );
        }
    }
    await saveGraph(nodes, edges, "发布节点");
}

async function syncWorkItems(): Promise<void> {
    const types = await listAll<WorkItemTypeResource>("/v2/pjm/workitem_types", "Failed to load work item types");
    const typeById = new Map(types.map((type) => [type.id, type]));
    const workItems = await listAll<WorkItemResource>("/v2/pjm/workitems", "Failed to load work items");
    const nodes: KgNode[] = [];
    const edges: KgEdge[] = [];
    for (const workItem of workItems) {
        const type = workItem.type?.id ? typeById.get(workItem.type.id) : undefined;
        const node = createWorkItemNode(toWorkItemInput(workItem, type));
        nodes.push(node);
        edges.push(
            ...linkTo(node.id, KG_NODE_KIND.project, workItem.project?.id, KG_EDGE_TYPE.belongsTo),
            ...belongsToUser(node.id, workItem.assignee?.id),
            ...linkTo(node.id, KG_NODE_KIND.sprint, workItem.sprint?.id, KG_EDGE_TYPE.plannedIn),
            ...linkTo(node.id, KG_NODE_KIND.workItem, parentRefId(workItem), KG_EDGE_TYPE.parentOf),
        );
        for (const release of workItem.releases ?? []) {
            edges.push(...linkTo(node.id, KG_NODE_KIND.release, release.id, KG_EDGE_TYPE.releasedIn));
        }
    }
    await saveGraph(nodes, edges, "工作项节点");
}

async function syncProducts(): Promise<void> {
    const products = await listAll<NamedContainer>("/v2/ship/products", "Failed to load products");
    const nodes = products.map((product) => createProductNode(toNamedContainerInput(product)));
    await saveNodes(nodes, "产品节点");
}

async function syncIdeas(): Promise<void> {
    const ideas = await listAll<IdeaResource>("/v2/ship/ideas", "Failed to load ideas");
    const nodes: KgNode[] = [];
    const edges: KgEdge[] = [];
    for (const idea of ideas) {
        const node = createIdeaNode(toIdeaInput(idea));
        nodes.push(node);
        edges.push(
            ...linkTo(node.id, KG_NODE_KIND.product, idea.product?.id, KG_EDGE_TYPE.belongsTo),
            ...belongsToUser(node.id, idea.assignee?.id),
        );
    }
    await saveGraph(nodes, edges, "需求节点");
}

async function syncTickets(): Promise<void> {
    const tickets = await listAll<TicketResource>("/v2/ship/tickets", "Failed to load tickets");
    const nodes: KgNode[] = [];
    const edges: KgEdge[] = [];
    for (const ticket of tickets) {
        const node = createTicketNode(toTicketInput(ticket));
        nodes.push(node);
        edges.push(
            ...linkTo(node.id, KG_NODE_KIND.product, ticket.product?.id, KG_EDGE_TYPE.belongsTo),
            ...belongsToUser(node.id, ticket.assignee?.id),
        );
    }
    await saveGraph(nodes, edges, "工单节点");
}

async function syncLibraries(): Promise<void> {
    const libraries = await listAll<NamedContainer>("/v2/testhub/libraries", "Failed to load libraries");
    const nodes = libraries.map((library) => createLibraryNode(toNamedContainerInput(library)));
    await saveNodes(nodes, "测试库节点");
}

async function syncTestCases(): Promise<void> {
    const testCases = await listAll<TestCaseResource>("/v2/testhub/testcases", "Failed to load test cases");
    const nodes: KgNode[] = [];
    const edges: KgEdge[] = [];
    for (const testCase of testCases) {
        const node = createTestCaseNode(toTestCaseInput(testCase));
        nodes.push(node);
        edges.push(...linkTo(node.id, KG_NODE_KIND.library, testCase.library?.id, KG_EDGE_TYPE.belongsTo));
    }
    await saveGraph(nodes, edges, "用例节点");
}

async function syncSpaces(): Promise<void> {
    const spaces = await listAll<NamedContainer>("/v2/wiki/spaces", "Failed to load spaces");
    const nodes = spaces.map((space) => createSpaceNode(toSpaceInput(space)));
    await saveNodes(nodes, "空间节点");
}

async function syncPages(): Promise<void> {
    const pages = await listAll<PageResource>("/v2/wiki/pages", "Failed to load pages");
    const nodes: KgNode[] = [];
    const edges: KgEdge[] = [];
    for (const page of pages) {
        const node = createPageNode(toPageInput(page));
        nodes.push(node);
        edges.push(...linkTo(node.id, KG_NODE_KIND.space, page.space?.id, KG_EDGE_TYPE.belongsTo));
    }
    await saveGraph(nodes, edges, "页面节点");
}

function toProjectInput(project: ProjectResource & { id: string }): ProjectNodeInput {
    const input: ProjectNodeInput = {
        refId: project.id,
        name: project.name ?? "",
        templateType: project.template_type ?? project.template?.type ?? "",
        active: project.is_deleted !== 1,
    };
    assignDefined(input, "identifier", project.identifier);
    assignDefined(input, "stateType", project.state?.type);
    assignDefined(input, "stateName", project.state?.name);
    assignDefined(input, "description", project.description);
    assignDefined(input, "startAt", timestamp(project.start));
    assignDefined(input, "endAt", timestamp(project.due));
    assignDefined(input, "isLocalConfigure", project.is_local_configure === undefined ? undefined : project.is_local_configure === 1);
    assignTimestamps(input, project.updated_at);
    return input;
}

function toSprintInput(sprint: SprintResource & { id: string }): SprintNodeInput {
    const input: SprintNodeInput = {
        refId: sprint.id,
        name: sprint.name ?? "",
        active: sprint.is_deleted !== 1,
    };
    assignDefined(input, "stateName", sprint.status);
    assignDefined(input, "startAt", timestamp(sprint.start));
    assignDefined(input, "endAt", timestamp(sprint.due));
    assignDefined(input, "startedAt", timestamp(sprint.started_at));
    assignDefined(input, "completedAt", timestamp(sprint.completed_at));
    assignDefined(input, "description", sprint.description);
    assignDefined(input, "categoryNames", categoryNames(sprint.categories));
    assignTimestamps(input, sprint.updated_at);
    return input;
}

function toReleaseInput(release: ReleaseResource & { id: string }): ReleaseNodeInput {
    const input: ReleaseNodeInput = {
        refId: release.id,
        name: release.name ?? "",
        active: release.is_deleted !== 1,
    };
    assignDefined(input, "stageName", release.stage?.name);
    assignDefined(input, "startAt", timestamp(release.start));
    assignDefined(input, "publishedAt", timestamp(release.published_at));
    assignTimestamps(input, release.updated_at);
    return input;
}

function toWorkItemInput(
    workItem: WorkItemResource & { id: string },
    type: WorkItemTypeResource | undefined,
): WorkItemNodeInput {
    const storyPoints = workItem.properties?.story_points;
    const input: WorkItemNodeInput = {
        refId: workItem.id,
        name: workItem.title ?? "",
        active: workItem.is_deleted !== 1,
    };
    assignDefined(input, "identifier", workItem.whole_identifier);
    assignDefined(input, "typeName", type?.name ?? workItem.type?.name);
    assignDefined(input, "typeIcon", type?.icon);
    assignDefined(input, "typeColor", type?.color);
    assignDefined(input, "stateType", workItem.state?.type);
    assignDefined(input, "stateName", workItem.state?.name);
    assignDefined(input, "priority", workItem.priority?.name);
    assignDefined(input, "startAt", timestamp(workItem.start));
    assignDefined(input, "endAt", timestamp(workItem.due));
    assignDefined(input, "description", workItem.description);
    assignDefined(input, "assigneeName", workItem.assignee?.display_name);
    assignDefined(input, "assigneeAvatar", workItem.assignee?.avatar);
    assignDefined(input, "sprintName", workItem.sprint?.name);
    assignDefined(input, "storyPoints", typeof storyPoints === "number" ? storyPoints : undefined);
    assignTimestamps(input, workItem.updated_at);
    return input;
}

function toNamedContainerInput(resource: NamedContainer & { id: string }): ProductNodeInput & LibraryNodeInput {
    const input: ProductNodeInput = {
        refId: resource.id,
        name: resource.name ?? "",
        active: resource.is_deleted !== 1,
    };
    assignDefined(input, "identifier", resource.identifier);
    assignDefined(input, "description", resource.description);
    assignTimestamps(input, resource.updated_at);
    return input;
}

function toSpaceInput(space: NamedContainer & { id: string }): SpaceNodeInput {
    const input: SpaceNodeInput = {
        refId: space.id,
        name: space.name ?? "",
        active: space.is_deleted !== 1,
    };
    assignDefined(input, "identifier", space.identifier);
    assignTimestamps(input, space.updated_at);
    return input;
}

function toIdeaInput(idea: IdeaResource & { id: string }): IdeaNodeInput {
    const input: IdeaNodeInput = {
        refId: idea.id,
        name: idea.title ?? "",
        active: idea.is_deleted !== 1,
    };
    assignDefined(input, "identifier", idea.whole_identifier);
    assignDefined(input, "stateType", idea.state?.type);
    assignDefined(input, "stateName", idea.state?.name);
    assignDefined(input, "description", idea.description);
    assignDefined(input, "priority", idea.priority?.name);
    assignDefined(input, "planDateBeginAt", spanPoint(idea.plan_at, "from"));
    assignDefined(input, "planDateEndAt", spanPoint(idea.plan_at, "to"));
    assignDefined(input, "planDateGranularity", idea.plan_at?.granularity);
    assignDefined(input, "realDateBeginAt", spanPoint(idea.real_at, "from"));
    assignDefined(input, "realDateEndAt", spanPoint(idea.real_at, "to"));
    assignDefined(input, "realDateGranularity", idea.real_at?.granularity);
    assignDefined(input, "assigneeName", idea.assignee?.display_name);
    assignDefined(input, "assigneeAvatar", idea.assignee?.avatar);
    assignTimestamps(input, idea.updated_at);
    return input;
}

function toTicketInput(ticket: TicketResource & { id: string }): TicketNodeInput {
    const input: TicketNodeInput = {
        refId: ticket.id,
        name: ticket.title ?? "",
        active: ticket.is_deleted !== 1,
    };
    assignDefined(input, "identifier", ticket.whole_identifier);
    assignDefined(input, "stateType", ticket.state?.type);
    assignDefined(input, "stateName", ticket.state?.name);
    assignDefined(input, "description", ticket.description);
    assignDefined(input, "priority", ticket.priority?.name);
    assignDefined(input, "solution", ticket.solution?.name);
    assignDefined(input, "channel", channelLabel(ticket.channel));
    assignDefined(input, "estimatedAt", spanPoint(ticket.estimated_at, "to"));
    assignDefined(input, "typeName", ticket.type?.name);
    assignDefined(input, "assigneeName", ticket.assignee?.display_name);
    assignDefined(input, "assigneeAvatar", ticket.assignee?.avatar);
    assignTimestamps(input, ticket.updated_at);
    return input;
}

function toTestCaseInput(testCase: TestCaseResource & { id: string }): TestCaseNodeInput {
    const input: TestCaseNodeInput = {
        refId: testCase.id,
        name: testCase.title ?? "",
        active: testCase.is_deleted !== 1,
    };
    assignDefined(input, "identifier", testCase.whole_identifier);
    assignDefined(input, "typeName", testCase.type?.name);
    assignDefined(input, "level", testCase.important_level?.name);
    assignDefined(input, "stateType", testCase.state?.type);
    assignDefined(input, "stateName", testCase.state?.name);
    assignDefined(input, "description", testCase.description);
    assignTimestamps(input, testCase.updated_at);
    return input;
}

function toPageInput(page: PageResource & { id: string }): PageNodeInput {
    const input: PageNodeInput = {
        refId: page.id,
        name: page.name ?? "",
        active: page.is_deleted !== 1,
    };
    assignDefined(input, "identifier", page.short_id);
    assignDefined(input, "typeName", page.type);
    assignTimestamps(input, page.updated_at);
    return input;
}

function spanPoint(span: DateSpan | null | undefined, side: "from" | "to"): number | undefined {
    return timestamp(span?.[side]);
}

function channelLabel(channel: TicketResource["channel"]): string | undefined {
    if (typeof channel === "string") {
        return channel || undefined;
    }
    return channel?.name;
}

function assignTimestamps(input: { sourceUpdatedAt?: number; syncedAt?: number }, updatedAt: number | undefined): void {
    if (typeof updatedAt === "number") {
        input.sourceUpdatedAt = updatedAt;
        input.syncedAt = updatedAt;
        return;
    }
    input.syncedAt = Math.floor(Date.now() / 1000);
}

function timestamp(value: DatePoint | number | null | undefined): number | undefined {
    if (typeof value === "number") {
        return value;
    }
    return typeof value?.date === "number" ? value.date : undefined;
}

function categoryNames(categories: Array<{ name?: string }> | undefined): string[] | undefined {
    if (!categories?.length) {
        return undefined;
    }
    const names = categories.flatMap((category) => (category.name ? [category.name] : []));
    return names.length > 0 ? names : undefined;
}

function parentRefId(workItem: WorkItemResource): string | undefined {
    if (workItem.parent?.id) {
        return workItem.parent.id;
    }
    return workItem.parent_id || undefined;
}

function belongsToUser(fromId: string, userId: string | undefined): KgEdge[] {
    return linkTo(fromId, KG_NODE_KIND.user, userId, KG_EDGE_TYPE.assignedTo);
}

function linkTo(fromId: string, kind: KgNodeKind, refId: string | undefined, type: KgEdge["type"]): KgEdge[] {
    if (!refId) {
        return [];
    }
    return [createKgEdge({
        fromId,
        toId: kgNodeId(kind, refId),
        type,
    })];
}

async function saveNodes(nodes: KgNode[], label: string): Promise<void> {
    await saveGraph(nodes, [], label);
}

async function saveGraph(nodes: KgNode[], edges: KgEdge[], label: string): Promise<void> {
    if (nodes.length === 0) {
        console.log(`❌ 没有${label}需要初始化`);
        return;
    }
    await insertInPages(KG_NODE_ENTITY_NAME, nodes);
    if (edges.length > 0) {
        await insertInPages(KG_EDGE_ENTITY_NAME, edges);
    }
    const relation = edges.length > 0 ? `，关系 ${edges.length} 条` : "";
    console.log(`✅ 初始化${label}完成，共 ${nodes.length} 个${relation}`);
}

async function insertInPages<T>(entityName: string, items: T[]): Promise<void> {
    for (let index = 0; index < items.length; index += PAGE_SIZE) {
        await ces.entity(entityName).insert(items.slice(index, index + PAGE_SIZE));
    }
}

async function listAll<T extends { id?: string }>(path: string, errorMessage: string): Promise<Array<T & { id: string }>> {
    const items: Array<T & { id: string }> = [];
    const seen = new Set<string>();
    let pageIndex = 0;
    const joiner = path.includes("?") ? "&" : "?";

    while (true) {
        const response = await api.invoke(`${path}${joiner}page_index=${pageIndex}&page_size=${PAGE_SIZE}`);
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(errorBody || errorMessage);
        }
        const data = (await response.json()) as PagedValues<T>;
        const values = data.values ?? [];
        const fresh = values.filter((item): item is T & { id: string } => {
            if (!item.id || seen.has(item.id)) {
                return false;
            }
            seen.add(item.id);
            return true;
        });
        items.push(...fresh);
        if (fresh.length === 0 || (typeof data.total === "number" && items.length >= data.total)) {
            break;
        }
        pageIndex += 1;
    }

    return items;
}
