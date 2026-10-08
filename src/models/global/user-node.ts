import { KG_NODE_KIND, createKgNode, joinSummary, type KgNodeBase } from "../pc-kg-node.js";

export interface UserNodeDetail {
    display_name: string;
    employee_number: string;
    email: string;
    mobile: string;
    title: string;
    gender: number;
    status: string;
    short_code: string;
}

export interface UserKgNode extends KgNodeBase<typeof KG_NODE_KIND.user, UserNodeDetail> {}

export interface UserNodeInput {
    refId: string;
    name: string;
    identifier?: string;
    displayName: string;
    employeeNumber: string;
    email: string;
    mobile: string;
    title: string;
    gender: number;
    status: string;
    shortCode: string;
    sourceUpdatedAt?: number;
    syncedAt?: number;
    active?: boolean;
}

export function createUserNode(input: UserNodeInput): UserKgNode {
    const detail: UserNodeDetail = {
        display_name: input.displayName,
        employee_number: input.employeeNumber,
        email: input.email,
        mobile: input.mobile,
        title: input.title,
        gender: input.gender,
        status: input.status,
        short_code: input.shortCode,
    };

    const title = [input.identifier, input.name].filter(Boolean).join(" ");
    return createKgNode(
        KG_NODE_KIND.user,
        {
            ...input,
            summary: joinSummary([title, input.displayName, input.title, input.status]),
        },
        detail,
    );
}
