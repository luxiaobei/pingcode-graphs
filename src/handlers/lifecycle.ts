import type { EventHandler } from "@pc-nexus/event";
import { api } from "@pc-nexus/network";
import { ces } from "@pc-nexus/storage";
import { createUserNode } from "../models/global/user-node.js";
import { KG_NODE_ENTITY_NAME, type KgNode } from "../models/pc-kg-node.js";

const PAGE_SIZE = 100;

interface PagedValues<T> {
    page_size?: number;
    page_index?: number;
    total?: number;
    values?: T[];
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

/** 安装时只同步用户。工作项及其项目、迭代、发布在第一次打开图谱时按需写入。 */
export const onAppInstalledHandler: EventHandler = async () => {
    console.log("🔄 初始化用户数据开始...");
    await syncDirectoryUsers();
    console.log("✅ 初始化用户数据完成");
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

async function saveNodes(nodes: KgNode[], label: string): Promise<void> {
    if (nodes.length === 0) {
        console.log(`❌ 没有${label}需要初始化`);
        return;
    }
    for (let index = 0; index < nodes.length; index += PAGE_SIZE) {
        await ces.entity(KG_NODE_ENTITY_NAME).insert(nodes.slice(index, index + PAGE_SIZE));
    }
    console.log(`✅ 初始化${label}完成，共 ${nodes.length} 个`);
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
