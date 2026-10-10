import { KG_NODE_KIND, type KgNodeKind } from "../models/pc-kg-node.js";

export const linkKindMap: Record<string, KgNodeKind> = {
    "workitem": KG_NODE_KIND.workItem,
    "ticket": KG_NODE_KIND.ticket,
    "idea": KG_NODE_KIND.idea,
    "page": KG_NODE_KIND.page,
    "testcase": KG_NODE_KIND.testCase,
} as const;