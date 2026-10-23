import { api } from "@pc-nexus/network";
import { ces } from "@pc-nexus/storage";
import { createKgEdge, KG_EDGE_ENTITY_NAME, KG_EDGE_TYPE, type KgEdge, type KgEdgeType } from "../models/pc-kg-edge.js";
import { KG_NODE_ENTITY_NAME, KG_NODE_KIND, kgNodeId, type KgNode, type KgNodeKind } from "../models/pc-kg-node.js";
import { buildOpenApiGraph } from "./node-seed.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 2000;
const WRITE_CONCURRENCY = 8;

/** 归属、负责人、迭代、发布和父项。已存在的同一条边不重复插入。阻塞、关联仍在第一次打开图谱时拉取。 */
const STRUCTURAL_EDGE_TYPES: readonly KgEdgeType[] = [
    KG_EDGE_TYPE.belongsTo,
    KG_EDGE_TYPE.assignedTo,
    KG_EDGE_TYPE.plannedIn,
    KG_EDGE_TYPE.releasedIn,
    KG_EDGE_TYPE.parentOf,
];

export interface SyncScopeResult {
    projects: number;
    workItems: number;
    sprints: number;
    releases: number;
    products: number;
    ideas: number;
    tickets: number;
    libraries: number;
    testCases: number;
}

interface ApiRecord {
    id: string;
    [key: string]: unknown;
}

interface BuiltNode {
    node: KgNode;
    edges: KgEdge[];
    sides: KgNode[];
}

interface ContainerRef {
    kind: KgNodeKind;
    id: string;
}

/**
 * 同步指定项目、产品和测试库。
 * 项目写入项目节点，以及项目内的工作项、迭代、发布。
 * 产品写入产品节点，以及其下的需求和工单。
 * 测试库写入测试库节点，以及其下的测试用例。
 * 已存在的节点按 id 更新，并保留原来的 active。
 */
export async function syncScope(payload: unknown): Promise<SyncScopeResult> {
    const input = readPayload(payload);
    const result = emptyResult();
    for (const projectId of input.projectIds) {
        const synced = await syncProject(projectId);
        result.projects += 1;
        result.workItems += synced.workItems;
        result.sprints += synced.sprints;
        result.releases += synced.releases;
    }
    for (const productId of input.productIds) {
        const synced = await syncProduct(productId);
        result.products += 1;
        result.ideas += synced.ideas;
        result.tickets += synced.tickets;
    }
    for (const libraryId of input.libraryIds) {
        const synced = await syncLibrary(libraryId);
        result.libraries += 1;
        result.testCases += synced.testCases;
    }
    return result;
}

async function syncProject(projectId: string): Promise<Pick<SyncScopeResult, "workItems" | "sprints" | "releases">> {
    console.log(`🔄 同步项目 ${projectId}`);
    const project = await fetchOne(`/v2/pjm/projects/${encodeURIComponent(projectId)}`, `Project not found: ${projectId}`);
    const [sprintRecords, releaseRecords, workItemRecords] = await Promise.all([
        listAll(`/v2/pjm/sprints?project_id=${encodeURIComponent(projectId)}`, "Failed to load sprints"),
        listAll(`/v2/pjm/releases?project_id=${encodeURIComponent(projectId)}`, "Failed to load releases"),
        listAll(`/v2/pjm/workitems?project_id=${encodeURIComponent(projectId)}`, "Failed to load work items"),
    ]);
    const container: ContainerRef = { kind: KG_NODE_KIND.project, id: projectId };
    const projectNode = await materialize(KG_NODE_KIND.project, [project]);
    const sprints = await materialize(KG_NODE_KIND.sprint, sprintRecords, container);
    const releases = await materialize(KG_NODE_KIND.release, releaseRecords, container);
    const workItems = await materialize(KG_NODE_KIND.workItem, workItemRecords, container, WRITE_CONCURRENCY);
    await saveBuilt([...projectNode, ...sprints, ...releases, ...workItems]);
    console.log(`✅ 项目 ${projectId} 同步完成：工作项 ${workItems.length}，迭代 ${sprints.length}，发布 ${releases.length}`);
    return {
        workItems: workItems.length,
        sprints: sprints.length,
        releases: releases.length,
    };
}

async function syncProduct(productId: string): Promise<Pick<SyncScopeResult, "ideas" | "tickets">> {
    console.log(`🔄 同步产品 ${productId}`);
    const product = await fetchOne(`/v2/ship/products/${encodeURIComponent(productId)}`, `Product not found: ${productId}`);
    const [ideaRecords, ticketRecords] = await Promise.all([
        listAll(`/v2/ship/ideas?product_id=${encodeURIComponent(productId)}`, "Failed to load ideas"),
        listAll(`/v2/ship/tickets?product_id=${encodeURIComponent(productId)}`, "Failed to load tickets"),
    ]);
    const container: ContainerRef = { kind: KG_NODE_KIND.product, id: productId };
    const productNode = await materialize(KG_NODE_KIND.product, [product]);
    const ideas = await materialize(KG_NODE_KIND.idea, ideaRecords, container);
    const tickets = await materialize(KG_NODE_KIND.ticket, ticketRecords, container);
    await saveBuilt([...productNode, ...ideas, ...tickets]);
    console.log(`✅ 产品 ${productId} 同步完成：需求 ${ideas.length}，工单 ${tickets.length}`);
    return { ideas: ideas.length, tickets: tickets.length };
}

async function syncLibrary(libraryId: string): Promise<Pick<SyncScopeResult, "testCases">> {
    console.log(`🔄 同步测试库 ${libraryId}`);
    const library = await fetchOne(`/v2/testhub/libraries/${encodeURIComponent(libraryId)}`, `Library not found: ${libraryId}`);
    const testCaseRecords = await listAll(
        `/v2/testhub/testcases?library_id=${encodeURIComponent(libraryId)}`,
        "Failed to load test cases",
    );
    const libraryNode = await materialize(KG_NODE_KIND.library, [library]);
    const testCases = await materialize(
        KG_NODE_KIND.testCase,
        testCaseRecords,
        { kind: KG_NODE_KIND.library, id: libraryId },
    );
    await saveBuilt([...libraryNode, ...testCases]);
    console.log(`✅ 测试库 ${libraryId} 同步完成：测试用例 ${testCases.length}`);
    return { testCases: testCases.length };
}

async function materialize(
    kind: KgNodeKind,
    records: ApiRecord[],
    container?: ContainerRef,
    concurrency = records.length || 1,
): Promise<BuiltNode[]> {
    const graphs = await mapLimited(records, concurrency, (record) => buildOpenApiGraph(kind, record));
    const built: BuiltNode[] = [];
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const graph = graphs[index];
        if (!record || !graph) {
            continue;
        }
        const node = graph.nodes.find((item) => item.id === kgNodeId(kind, record.id));
        if (!node) {
            continue;
        }
        let edges = graph.edges.filter((edge) => edge.from_id === node.id && edge.from_id !== edge.to_id);
        edges = mergeAssignee(edges, node.id, record);
        if (container) {
            edges = mergeContainer(edges, node.id, container);
        }
        built.push({
            node,
            edges,
            sides: graph.nodes.filter((item) => item.id !== node.id),
        });
    }
    return built;
}

async function saveBuilt(items: BuiltNode[]): Promise<void> {
    const primaries = dedupe(items.map((item) => item.node), (node) => node.id);
    const sides = dedupe(items.flatMap((item) => item.sides), (node) => node.id)
        .filter((node) => !primaries.some((primary) => primary.id === node.id));
    await upsertNodes(primaries);
    await insertIfAbsent(sides);
    await replaceStructuralEdges(items.map((item) => ({ fromId: item.node.id, edges: item.edges })));
}

async function upsertNodes(nodes: KgNode[]): Promise<void> {
    if (nodes.length === 0) {
        return;
    }
    const existing = await findNodes(nodes.map((node) => node.id));
    const have = new Set(existing.map((node) => node.id));
    const fresh = nodes.filter((node) => !have.has(node.id));
    const stale = nodes.filter((node) => have.has(node.id));
    for (const chunk of chunks(fresh, PAGE_SIZE)) {
        await ces.entity(KG_NODE_ENTITY_NAME).insert(chunk);
    }
    await mapLimited(stale, WRITE_CONCURRENCY, async (node) => {
        await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).update((cb) => {
            cb.field("id").eq(node.id);
        }, withoutActive(node));
    });
}

async function insertIfAbsent(nodes: KgNode[]): Promise<void> {
    if (nodes.length === 0) {
        return;
    }
    const existing = await findNodes(nodes.map((node) => node.id));
    const have = new Set(existing.map((node) => node.id));
    const fresh = nodes.filter((node) => !have.has(node.id));
    for (const chunk of chunks(fresh, PAGE_SIZE)) {
        await ces.entity(KG_NODE_ENTITY_NAME).insert(chunk);
    }
}

/**
 * 边 id 由 from、type、to 决定，和节点 id 一样稳定。
 * 已经存在的同一条边保持不动；只删除目标已经变掉的旧边，再插入还没有的边。
 */
async function replaceStructuralEdges(groups: Array<{ fromId: string; edges: KgEdge[] }>): Promise<void> {
    const uniqueGroups = dedupe(groups, (group) => group.fromId);
    const desired = dedupe(
        uniqueGroups.flatMap((group) => group.edges.filter((edge) => edge.from_id === group.fromId)),
        (edge) => edge.id,
    );
    const existing = await findStructuralEdges(uniqueGroups.map((group) => group.fromId));
    const desiredIds = new Set(desired.map((edge) => edge.id));
    const existingIds = new Set(existing.map((edge) => edge.id));
    const staleIds = existing.flatMap((edge) => desiredIds.has(edge.id) ? [] : [edge.id]);
    const fresh = desired.filter((edge) => !existingIds.has(edge.id));
    await deleteEdges(staleIds);
    for (const chunk of chunks(fresh, PAGE_SIZE)) {
        await ces.entity(KG_EDGE_ENTITY_NAME).insert(chunk);
    }
}

async function findStructuralEdges(fromIds: string[]): Promise<KgEdge[]> {
    const found: KgEdge[] = [];
    for (const chunk of chunks(fromIds, PAGE_SIZE)) {
        if (chunk.length === 0) {
            continue;
        }
        const rows = await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).find((cb) => {
            if (chunk.length === 1) {
                cb.field("from_id").eq(chunk[0]!);
            } else {
                cb.or((or) => {
                    for (const id of chunk) {
                        or.field("from_id").eq(id);
                    }
                });
            }
            cb.or((or) => {
                for (const type of STRUCTURAL_EDGE_TYPES) {
                    or.field("type").eq(type);
                }
            });
        });
        found.push(...rows);
    }
    return found;
}

async function deleteEdges(ids: string[]): Promise<void> {
    for (const chunk of chunks(ids, PAGE_SIZE)) {
        await ces.entity<KgEdge>(KG_EDGE_ENTITY_NAME).delete((cb) => {
            if (chunk.length === 1) {
                cb.field("id").eq(chunk[0]!);
                return;
            }
            cb.or((or) => {
                for (const id of chunk) {
                    or.field("id").eq(id);
                }
            });
        });
    }
}

function withoutActive(node: KgNode): Partial<KgNode> {
    const patch: Record<string, unknown> = { ...node };
    delete patch["active"];
    return patch as Partial<KgNode>;
}

async function fetchOne(path: string, notFoundMessage: string): Promise<ApiRecord> {
    const response = await api.invoke(path);
    if (response.status === 404) {
        throw new Error(notFoundMessage);
    }
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || `Failed to load ${path}`);
    }
    const record = asRecord(unwrapDetail(await response.json()));
    if (!record?.id) {
        throw new Error(`Failed to load ${path}`);
    }
    return record;
}

async function listAll(path: string, errorMessage: string): Promise<ApiRecord[]> {
    const items: ApiRecord[] = [];
    const seen = new Set<string>();
    let pageIndex = 0;
    const joiner = path.includes("?") ? "&" : "?";
    while (pageIndex < MAX_PAGES) {
        const response = await api.invoke(`${path}${joiner}page_index=${pageIndex}&page_size=${PAGE_SIZE}`);
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(errorBody || errorMessage);
        }
        const data = asPage(await response.json());
        if (typeof data.total !== "number" || !Array.isArray(data.values)) {
            throw new Error(errorMessage);
        }
        const fresh = data.values.filter((item) => {
            if (seen.has(item.id)) {
                return false;
            }
            seen.add(item.id);
            return true;
        });
        items.push(...fresh);
        if (items.length >= data.total || data.values.length === 0) {
            if (items.length < data.total) {
                throw new Error(`${errorMessage}: got ${items.length} of ${data.total}`);
            }
            break;
        }
        if (fresh.length === 0) {
            throw new Error(`${errorMessage}: got ${items.length} of ${data.total}`);
        }
        pageIndex += 1;
    }
    if (pageIndex >= MAX_PAGES) {
        throw new Error(`${errorMessage}: exceeded ${MAX_PAGES} pages`);
    }
    return items;
}

function mergeAssignee(edges: KgEdge[], fromId: string, record: ApiRecord): KgEdge[] {
    const rest = edges.filter((edge) => edge.type !== KG_EDGE_TYPE.assignedTo);
    const assigneeId = nestedId(record["assignee"]);
    if (!assigneeId) {
        return rest;
    }
    rest.push(createKgEdge({
        fromId,
        toId: kgNodeId(KG_NODE_KIND.user, assigneeId),
        type: KG_EDGE_TYPE.assignedTo,
    }));
    return rest;
}

function mergeContainer(edges: KgEdge[], fromId: string, container: ContainerRef): KgEdge[] {
    const rest = edges.filter((edge) => edge.type !== KG_EDGE_TYPE.belongsTo);
    rest.push(createKgEdge({
        fromId,
        toId: kgNodeId(container.kind, container.id),
        type: KG_EDGE_TYPE.belongsTo,
    }));
    return rest;
}

function readPayload(payload: unknown): { projectIds: string[]; productIds: string[]; libraryIds: string[] } {
    if (payload == null) {
        return { projectIds: [], productIds: [], libraryIds: [] };
    }
    const record = asObject(payload);
    if (!record) {
        throw new Error("syncScope payload must be an object");
    }
    return {
        projectIds: readIds(record["projectIds"], "projectIds"),
        productIds: readIds(record["productIds"], "productIds"),
        libraryIds: readIds(record["libraryIds"], "libraryIds"),
    };
}

function readIds(value: unknown, key: string): string[] {
    if (value == null) {
        return [];
    }
    const list = typeof value === "string" ? [value] : value;
    if (!Array.isArray(list)) {
        throw new Error(`${key} must be an array of ids`);
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const item of list) {
        if (typeof item !== "string" || item.trim().length === 0) {
            throw new Error(`${key} must be an array of ids`);
        }
        const id = item.trim();
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

function emptyResult(): SyncScopeResult {
    return {
        projects: 0,
        workItems: 0,
        sprints: 0,
        releases: 0,
        products: 0,
        ideas: 0,
        tickets: 0,
        libraries: 0,
        testCases: 0,
    };
}

async function findNodes(ids: string[]): Promise<KgNode[]> {
    const found: KgNode[] = [];
    for (const chunk of chunks(ids, PAGE_SIZE)) {
        if (chunk.length === 0) {
            continue;
        }
        const rows = await ces.entity<KgNode>(KG_NODE_ENTITY_NAME).find((cb) => {
            if (chunk.length === 1) {
                cb.field("id").eq(chunk[0]!);
                return;
            }
            cb.or((or) => {
                for (const id of chunk) {
                    or.field("id").eq(id);
                }
            });
        });
        found.push(...rows);
    }
    return found;
}

async function mapLimited<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workers = Math.min(Math.max(limit, 1), items.length);
    await Promise.all(Array.from({ length: workers }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            const item = items[index];
            if (item === undefined) {
                return;
            }
            results[index] = await worker(item);
        }
    }));
    return results;
}

function chunks<T>(items: T[], size: number): T[][] {
    const groups: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        groups.push(items.slice(index, index + size));
    }
    return groups;
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

interface PageBody {
    total?: number;
    values?: ApiRecord[];
}

function asPage(body: unknown): PageBody {
    const record = asObject(body);
    if (!record) {
        return {};
    }
    if (Array.isArray(record["values"]) || typeof record["total"] === "number") {
        return toPage(record);
    }
    const nested = asObject(record["data"]);
    if (nested && (Array.isArray(nested["values"]) || typeof nested["total"] === "number")) {
        return toPage(nested);
    }
    return {};
}

function toPage(record: Record<string, unknown>): PageBody {
    const values = Array.isArray(record["values"])
        ? record["values"].flatMap((item) => {
            const row = asRecord(item);
            return row ? [row] : [];
        })
        : undefined;
    const page: PageBody = {};
    if (typeof record["total"] === "number") {
        page.total = record["total"];
    }
    if (values) {
        page.values = values;
    }
    return page;
}

function unwrapDetail(body: unknown): unknown {
    const record = asObject(body);
    if (!record) {
        return undefined;
    }
    if (typeof record["id"] === "string") {
        return record;
    }
    return asObject(record["data"]) ?? asObject(record["value"]);
}

function asRecord(value: unknown): ApiRecord | undefined {
    const record = asObject(value);
    const id = record?.["id"];
    if (!record || typeof id !== "string" || id.length === 0) {
        return undefined;
    }
    return record as ApiRecord;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
}

function nestedId(value: unknown): string | undefined {
    const record = asObject(value);
    const id = record?.["id"];
    return typeof id === "string" && id.length > 0 ? id : undefined;
}
