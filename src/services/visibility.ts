import { api } from "@pc-nexus/network";
import { KG_NODE_KIND, type KgNodeKind } from "../models/pc-kg-node.js";

const visibilityUrlMap: Record<KgNodeKind, string> = {
    [KG_NODE_KIND.workItem]: "/v2/pjm/workitems",
    [KG_NODE_KIND.ticket]: "/v2/ship/tickets",
    [KG_NODE_KIND.idea]: "/v2/ship/ideas",
    [KG_NODE_KIND.testCase]: "/v2/testhub/testcases",
    [KG_NODE_KIND.page]: "/v2/wiki/pages",

    [KG_NODE_KIND.space]: "",
    [KG_NODE_KIND.project]: "",
    [KG_NODE_KIND.sprint]: "",
    [KG_NODE_KIND.release]: "",
    [KG_NODE_KIND.product]: "",
    [KG_NODE_KIND.library]: "",
    [KG_NODE_KIND.user]: "",
};

const noPermissionCodeMap: Record<string, string> = {
    [KG_NODE_KIND.workItem]: "100037",
    [KG_NODE_KIND.ticket]: "100711",
    [KG_NODE_KIND.idea]: "100725",
    [KG_NODE_KIND.testCase]: "100601",
    [KG_NODE_KIND.page]: "100901",
};

export async function isVisible(kind: KgNodeKind, refId: string): Promise<boolean> {
    const path = visibilityUrlMap[kind];
    if (!path) {
        return true;
    }
    const response = await api.invoke(`${path}/${refId}`, { as: "user" });
    const data = await response.json();
    if (noPermissionCodeMap[kind] === data.code) {
        return false;
    }
    return true;
}
