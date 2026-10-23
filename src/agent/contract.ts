import { KG_EDGE_TYPE, type KgEdgeType } from "../models/pc-kg-edge.js";
import { KG_NODE_KIND, isKgNodeId, type KgNode, type KgNodeKind } from "../models/pc-kg-node.js";
import type { KgRelationDirection } from "../services/kg-service.js";

export const SEARCH_LIMIT = 8;
export const RELATION_NODE_LIMIT = 40;
export const MAX_TOOL_ROUNDS = 4;
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_HISTORY_MESSAGES = 8;
export const MAX_HISTORY_CHARS = 8_000;
export const MAX_CONTEXT_TOKENS = 32_768;
export const MAX_OUTPUT_TOKENS = 2_048;
export const MAX_TOOL_RESULT_CHARS = 12_000;

const USER_CONTACT_KEYS = ["email", "mobile", "employee_number"] as const;
const EDGE_TYPES = new Set<string>(Object.values(KG_EDGE_TYPE));
const NODE_KINDS = new Set<string>(Object.values(KG_NODE_KIND));
const DIRECTIONS = new Set<KgRelationDirection>(["outgoing", "incoming", "both"]);

export class AgentError extends Error {
    readonly statusCode: number;

    constructor(message: string, statusCode: number) {
        super(message);
        this.name = "AgentError";
        this.statusCode = statusCode;
    }
}

export interface HistoryMessage {
    role: "user" | "assistant";
    content: string;
}

export interface AskInput {
    question: string;
    focusNodeId?: string;
    messages: HistoryMessage[];
}

export interface FunctionTool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface ToolCallWire {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export type ChatMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string | null; tool_calls?: ToolCallWire[] }
    | { role: "tool"; tool_call_id: string; content: string };

export interface ModelToolCall {
    id: string;
    name: string;
    arguments: string;
}

export interface ModelMessage {
    content: string | null;
    toolCalls: ModelToolCall[];
    finishReason?: string;
}

export type ToolCommand =
    | { name: "search_nodes"; query: string; kind?: KgNodeKind }
    | { name: "get_node"; nodeId: string; includeContact: boolean }
    | {
          name: "get_relations";
          nodeId: string;
          types: KgEdgeType[];
          depth: number;
          direction: KgRelationDirection;
          depthClamped: boolean;
      };

export interface ToolResult {
    ok: boolean;
    summary: string;
    body: unknown;
}

export interface AgentStep {
    tool: string;
    ok: boolean;
    summary: string;
}

export interface AgentAnswer {
    answer: string;
    steps: AgentStep[];
}

const kindEnum = Object.values(KG_NODE_KIND);
const edgeEnum = Object.values(KG_EDGE_TYPE);

export const GRAPH_AGENT_TOOLS: FunctionTool[] = [
    {
        type: "function",
        function: {
            name: "search_nodes",
            description:
                "按编号、标题或姓名查找图谱节点。query 至少 2 个字符。若返回 exactIdentifier，直接使用该节点；否则多个命中时先让用户确认。",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "编号、标题或姓名，例如 ABC-12" },
                    kind: { type: "string", enum: kindEnum, description: "可选，限定节点种类" },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_node",
            description: "读取一个节点的状态和详情。不能靠它发现新关系。includeContact 仅在用户明确索要联系方式时为 true。",
            parameters: {
                type: "object",
                properties: {
                    nodeId: { type: "string", description: "节点 id，形如 work_item:xxx" },
                    includeContact: { type: "boolean", description: "是否返回成员的邮箱、手机号和工号" },
                },
                required: ["nodeId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_relations",
            description:
                "从节点沿一种或多种关系扩展。parent_of 存储为子→父，与英文 parent of 相反：outgoing 的 to_id 是父项，incoming 的 from_id 是子项。A —parent_of→ B 时 B 是父、A 是子。blocks 与 blocked_by 要分别列入 types，不要互相取反。depth 最大 3。",
            parameters: {
                type: "object",
                properties: {
                    nodeId: { type: "string", description: "起点节点 id" },
                    types: {
                        type: "array",
                        items: { type: "string", enum: edgeEnum },
                        description: "要走的边类型，一次传齐",
                    },
                    depth: { type: "integer", minimum: 1, maximum: 3, description: "最大跳数，1 表示只看直接邻居" },
                    direction: {
                        type: "string",
                        enum: ["outgoing", "incoming", "both"],
                        description: "outgoing 为 from→to，incoming 为 to→from，默认 outgoing",
                    },
                },
                required: ["nodeId", "types"],
            },
        },
    },
];

export function normalizeAskInput(raw: unknown): AskInput {
    if (!isRecord(raw)) {
        throw new AgentError("请求体必须是 JSON 对象", 400);
    }
    for (const key of Object.keys(raw)) {
        if (key !== "question" && key !== "focusNodeId" && key !== "messages") {
            throw new AgentError(`未知字段：${key}`, 400);
        }
    }
    if (typeof raw["question"] !== "string") {
        throw new AgentError("question 必须是字符串", 400);
    }
    const question = raw["question"].trim();
    if (!question) {
        throw new AgentError("question 不能为空", 400);
    }
    if (question.length > MAX_QUESTION_LENGTH) {
        throw new AgentError(`question 最长 ${MAX_QUESTION_LENGTH} 个字符`, 400);
    }

    const messages = readHistory(raw["messages"]);
    const historyChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    if (question.length + historyChars > MAX_HISTORY_CHARS) {
        throw new AgentError(`question 与 messages 合计最长 ${MAX_HISTORY_CHARS} 个字符`, 400);
    }

    const input: AskInput = {
        question,
        messages,
    };
    if (raw["focusNodeId"] !== undefined && raw["focusNodeId"] !== null && raw["focusNodeId"] !== "") {
        if (typeof raw["focusNodeId"] !== "string" || !isKgNodeId(raw["focusNodeId"].trim())) {
            throw new AgentError("focusNodeId 必须是 kind:refId", 400);
        }
        input.focusNodeId = raw["focusNodeId"].trim();
    }
    return input;
}

export function parseToolCall(name: string, rawArguments: string): { command: ToolCommand } | { error: string } {
    if (rawArguments.length > 8_000) {
        return { error: "工具参数过长" };
    }
    let args: unknown;
    try {
        args = rawArguments.trim() ? JSON.parse(rawArguments) : {};
    } catch {
        return { error: "工具参数不是合法 JSON" };
    }
    if (!isRecord(args)) {
        return { error: "工具参数必须是对象" };
    }
    if (name === "search_nodes") {
        return parseSearch(args);
    }
    if (name === "get_node") {
        return parseGetNode(args);
    }
    if (name === "get_relations") {
        return parseRelations(args);
    }
    return { error: `未知工具：${name}` };
}

export function matchRank(node: { identifier?: string; name: string }, query: string): number {
    const needle = query.toLowerCase();
    const identifier = node.identifier?.toLowerCase() ?? "";
    const name = node.name.toLowerCase();
    if (identifier && identifier === needle) {
        return 0;
    }
    if (name === needle) {
        return 1;
    }
    if (identifier.includes(needle)) {
        return 2;
    }
    if (name.includes(needle)) {
        return 3;
    }
    return 4;
}

export interface PublicNode {
    id: string;
    kind: KgNodeKind;
    identifier?: string;
    name: string;
    summary?: string;
    active: boolean;
    detail?: unknown;
}

export function presentNode(node: KgNode, includeContact: boolean): PublicNode {
    const presented: PublicNode = {
        id: node.id,
        kind: node.kind,
        name: node.name,
        active: node.active !== false,
    };
    assignOptional(presented, "identifier", node.identifier);
    assignOptional(presented, "summary", node.summary);
    const detail = presentDetail(node, includeContact);
    if (detail !== undefined) {
        presented.detail = detail;
    }
    return presented;
}

export function presentNodeSummary(node: KgNode): PublicNode {
    const presented = presentNode(node, false);
    delete presented.detail;
    return presented;
}

export function clipToolContent(body: unknown): string {
    const content = JSON.stringify(body);
    if (content.length <= MAX_TOOL_RESULT_CHARS) {
        return content;
    }
    return JSON.stringify({
        error: "结果过长，请缩小 depth 或 types",
        preview: content.slice(0, 2_000),
    });
}

function presentDetail(node: KgNode, includeContact: boolean): unknown {
    if (node.detail === undefined) {
        return undefined;
    }
    if (node.kind !== KG_NODE_KIND.user || includeContact) {
        return node.detail;
    }
    const detail = { ...(node.detail as unknown as Record<string, unknown>) };
    for (const key of USER_CONTACT_KEYS) {
        delete detail[key];
    }
    return detail;
}

function parseSearch(args: Record<string, unknown>): { command: ToolCommand } | { error: string } {
    if (typeof args["query"] !== "string" || args["query"].trim().length < 2) {
        return { error: "query 至少 2 个字符" };
    }
    const query = args["query"].trim();
    if (query.length > 80) {
        return { error: "query 最长 80 个字符" };
    }
    if (args["kind"] !== undefined && (typeof args["kind"] !== "string" || !NODE_KINDS.has(args["kind"]))) {
        return { error: "kind 不是已知节点类型" };
    }
    const command: ToolCommand = { name: "search_nodes", query };
    if (typeof args["kind"] === "string") {
        return { command: { name: "search_nodes", query, kind: args["kind"] as KgNodeKind } };
    }
    return { command };
}

function parseGetNode(args: Record<string, unknown>): { command: ToolCommand } | { error: string } {
    const nodeId = readNodeId(args["nodeId"]);
    if (!nodeId.ok) {
        return { error: nodeId.error };
    }
    if (args["includeContact"] !== undefined && typeof args["includeContact"] !== "boolean") {
        return { error: "includeContact 必须是布尔值" };
    }
    return {
        command: {
            name: "get_node",
            nodeId: nodeId.nodeId,
            includeContact: args["includeContact"] === true,
        },
    };
}

function parseRelations(args: Record<string, unknown>): { command: ToolCommand } | { error: string } {
    const nodeId = readNodeId(args["nodeId"]);
    if (!nodeId.ok) {
        return { error: nodeId.error };
    }
    const types = readTypes(args["types"]);
    if (typeof types === "string") {
        return { error: types };
    }
    const depth = readDepth(args["depth"]);
    if (typeof depth === "string") {
        return { error: depth };
    }
    const direction = readDirection(args["direction"]);
    if (!direction.ok) {
        return { error: direction.error };
    }
    return {
        command: {
            name: "get_relations",
            nodeId: nodeId.nodeId,
            types,
            depth: depth.depth,
            direction: direction.direction,
            depthClamped: depth.clamped,
        },
    };
}

function readNodeId(value: unknown): { ok: true; nodeId: string } | { ok: false; error: string } {
    if (typeof value !== "string" || !isKgNodeId(value.trim())) {
        return { ok: false, error: "nodeId 必须是 kind:refId" };
    }
    return { ok: true, nodeId: value.trim() };
}

function readTypes(value: unknown): KgEdgeType[] | string {
    const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
    if (raw.length === 0) {
        return "types 不能为空";
    }
    const types: KgEdgeType[] = [];
    for (const item of raw) {
        if (typeof item !== "string" || !EDGE_TYPES.has(item)) {
            return `未知关系类型：${String(item)}`;
        }
        const edgeType = item as KgEdgeType;
        if (!types.includes(edgeType)) {
            types.push(edgeType);
        }
    }
    return types;
}

function readDepth(value: unknown): { depth: number; clamped: boolean } | string {
    const numeric = value === undefined ? 1 : typeof value === "number" ? value : Number.NaN;
    if (!Number.isFinite(numeric)) {
        return "depth 必须是数字";
    }
    const floored = Math.floor(numeric);
    if (floored < 1) {
        return "depth 至少为 1";
    }
    if (floored > 3) {
        return { depth: 3, clamped: true };
    }
    return { depth: floored, clamped: false };
}

function readDirection(value: unknown): { ok: true; direction: KgRelationDirection } | { ok: false; error: string } {
    if (value === undefined) {
        return { ok: true, direction: "outgoing" };
    }
    if (typeof value === "string" && DIRECTIONS.has(value as KgRelationDirection)) {
        return { ok: true, direction: value as KgRelationDirection };
    }
    return { ok: false, error: "direction 只能是 outgoing、incoming 或 both" };
}

function readHistory(value: unknown): HistoryMessage[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new AgentError("messages 必须是数组", 400);
    }
    if (value.length > MAX_HISTORY_MESSAGES) {
        throw new AgentError(`messages 最多 ${MAX_HISTORY_MESSAGES} 条`, 400);
    }
    const messages = value.map((item, index) => {
        if (!isRecord(item) || (item["role"] !== "user" && item["role"] !== "assistant")) {
            throw new AgentError("messages 只接受 user 和 assistant", 400);
        }
        const expected: "user" | "assistant" = index % 2 === 0 ? "user" : "assistant";
        if (item["role"] !== expected) {
            throw new AgentError("messages 需要以 user 开头，并与 assistant 交替", 400);
        }
        if (typeof item["content"] !== "string" || !item["content"].trim()) {
            throw new AgentError("messages.content 必须是非空字符串", 400);
        }
        if (item["content"].length > MAX_QUESTION_LENGTH) {
            throw new AgentError(`messages.content 最长 ${MAX_QUESTION_LENGTH} 个字符`, 400);
        }
        return { role: expected, content: item["content"] };
    });
    if (messages.length % 2 !== 0) {
        throw new AgentError("messages 需要以 assistant 结尾", 400);
    }
    return messages;
}

function assignOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
    if (value !== undefined) {
        target[key] = value;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
