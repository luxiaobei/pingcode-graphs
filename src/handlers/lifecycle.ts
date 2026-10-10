import type { EventHandler } from "@pc-nexus/event";
import { api } from "@pc-nexus/network";
import { ces } from "@pc-nexus/storage";
import { createUserNode } from "../models/global/user-node.js";
import { KG_NODE_ENTITY_NAME } from "../models/pc-kg-node.js";

const DIRECTORY_USERS_PAGE_SIZE = 100;

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

interface DirectoryUserList {
    page_size?: number;
    page_index?: number;
    total?: number;
    values?: DirectoryUser[];
}

export const onAppInstalledHandler: EventHandler = async () => {
    const users = await listDirectoryUsers();
    const nodes = users.flatMap((user) => {
        if (!user.id) {
            return [];
        }
        return [createUserNode({
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
        })];
    });
    if (nodes.length === 0) {
        return;
    }
    await ces.entity(KG_NODE_ENTITY_NAME).insert(nodes);
};

async function listDirectoryUsers(): Promise<DirectoryUser[]> {
    const users: DirectoryUser[] = [];
    const seen = new Set<string>();
    let pageIndex = 0;

    while (true) {
        const response = await api.invoke(
            `/v1/directory/users?page_index=${pageIndex}&page_size=${DIRECTORY_USERS_PAGE_SIZE}`,
        );
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(errorBody || "Failed to load directory users");
        }
        const data = (await response.json()) as DirectoryUserList;
        const values = data.values ?? [];
        const fresh = values.filter((user) => {
            if (!user.id || seen.has(user.id)) {
                return false;
            }
            seen.add(user.id);
            return true;
        });
        users.push(...fresh);
        if (fresh.length === 0 || (typeof data.total === "number" && users.length >= data.total)) {
            break;
        }
        pageIndex += 1;
    }

    return users;
}
