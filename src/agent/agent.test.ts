import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KG_NODE_KIND, type KgNode } from "../models/pc-kg-node.js";
import {
    AgentError,
    matchRank,
    normalizeAskInput,
    parseToolCall,
    presentNode,
    clipToolContent,
    MAX_TOOL_RESULT_CHARS,
    GRAPH_AGENT_TOOLS,
    type AskInput,
    type ChatMessage,
    type ToolCommand,
    type ToolResult,
} from "./contract.js";
import { parseChatCompletion } from "./deepseek.js";
import { GRAPH_AGENT_PROMPT } from "./prompt.js";
import { contextTokens, runAgentLoop, type AgentRuntime } from "./loop.js";

describe("normalizeAskInput", () => {
    it("requires a question", () => {
        assert.throws(() => normalizeAskInput({ question: "  " }), (error: unknown) => {
            assert.ok(error instanceof AgentError);
            assert.equal(error.statusCode, 400);
            return true;
        });
    });

    it("rejects tool messages in history", () => {
        assert.throws(() => normalizeAskInput({
            question: "谁阻塞了它？",
            messages: [{ role: "tool", content: "{}" }],
        }), /user 和 assistant/);
    });

    it("rejects unknown fields", () => {
        assert.throws(() => normalizeAskInput({ question: "父项是谁？", apiKey: "secret" }), /未知字段/);
    });

    it("keeps a valid focus node", () => {
        const input = normalizeAskInput({
            question: "父项是谁？",
            focusNodeId: "work_item:abc",
        });
        assert.equal(input.focusNodeId, "work_item:abc");
        assert.deepEqual(input.messages, []);
    });

    it("keeps alternating history that ends with assistant", () => {
        const input = normalizeAskInput({
            question: "那子项呢？",
            messages: [
                { role: "user", content: "父项是谁？" },
                { role: "assistant", content: "CSZB-3 是父项。" },
            ],
        });
        assert.equal(input.messages[1]?.content, "CSZB-3 是父项。");
    });

    it("rejects history that does not end with assistant", () => {
        assert.throws(() => normalizeAskInput({
            question: "那子项呢？",
            messages: [{ role: "user", content: "父项是谁？" }],
        }), /assistant 结尾/);
    });

    it("rejects history that does not start with user", () => {
        assert.throws(() => normalizeAskInput({
            question: "那子项呢？",
            messages: [
                { role: "assistant", content: "先说结论。" },
                { role: "user", content: "父项是谁？" },
            ],
        }), /交替/);
    });

    it("rejects history that overflows the character budget", () => {
        const chunk = "问".repeat(2000);
        assert.throws(() => normalizeAskInput({
            question: chunk,
            messages: [
                { role: "user", content: chunk },
                { role: "assistant", content: chunk },
                { role: "user", content: chunk },
                { role: "assistant", content: chunk },
            ],
        }), /合计最长/);
    });
});

describe("parseToolCall", () => {
    it("parses a search", () => {
        const parsed = parseToolCall("search_nodes", JSON.stringify({ query: "ABC-12", kind: "work_item" }));
        assert.deepEqual(parsed, { command: { name: "search_nodes", query: "ABC-12", kind: "work_item" } });
    });

    it("rejects a short query", () => {
        assert.deepEqual(parseToolCall("search_nodes", JSON.stringify({ query: "A" })), { error: "query 至少 2 个字符" });
    });

    it("clamps relation depth and defaults direction", () => {
        const parsed = parseToolCall("get_relations", JSON.stringify({
            nodeId: "work_item:abc",
            types: "blocks",
            depth: 9,
        }));
        assert.deepEqual(parsed, {
            command: {
                name: "get_relations",
                nodeId: "work_item:abc",
                types: ["blocks"],
                depth: 3,
                direction: "outgoing",
                depthClamped: true,
            },
        });
    });

    it("rejects an unknown tool and invalid JSON", () => {
        assert.equal("error" in parseToolCall("explode", "{}"), true);
        assert.deepEqual(parseToolCall("get_node", "{"), { error: "工具参数不是合法 JSON" });
    });
});

describe("presentNode", () => {
    const user: KgNode = {
        id: "user:1",
        kind: KG_NODE_KIND.user,
        ref_id: "1",
        name: "张三",
        detail: {
            display_name: "张三",
            employee_number: "E1",
            email: "a@example.com",
            mobile: "13800000000",
            title: "工程师",
            gender: 1,
            status: "normal",
            short_code: "zs",
        },
    };

    it("hides contact fields unless requested", () => {
        const hidden = presentNode(user, false);
        const shown = presentNode(user, true);
        assert.equal((hidden.detail as { email?: string }).email, undefined);
        assert.equal((shown.detail as { email?: string }).email, "a@example.com");
        assert.equal((hidden.detail as { title?: string }).title, "工程师");
    });
});

describe("clipToolContent", () => {
    it("keeps an oversized tool result as JSON", () => {
        const content = clipToolContent({ text: "x".repeat(MAX_TOOL_RESULT_CHARS) });
        const parsed = JSON.parse(content) as { error: string };
        assert.match(parsed.error, /结果过长/);
    });
});

describe("matchRank", () => {
    it("prefers an exact identifier over a name hit", () => {
        const exact = matchRank({ identifier: "ABC-12", name: "登录" }, "abc-12");
        const name = matchRank({ identifier: "ABC-120", name: "abc-12" }, "abc-12");
        assert.ok(exact < name);
    });
});

describe("parseChatCompletion", () => {
    it("reads tool calls", () => {
        const message = parseChatCompletion({
            choices: [{
                finish_reason: "tool_calls",
                message: {
                    content: null,
                    tool_calls: [{
                        id: "call-1",
                        type: "function",
                        function: { name: "search_nodes", arguments: "{\"query\":\"ABC-12\"}" },
                    }],
                },
            }],
        });
        assert.equal(message.toolCalls[0]?.name, "search_nodes");
        assert.equal(message.finishReason, "tool_calls");
    });

    it("rejects a filtered answer", () => {
        assert.throws(() => parseChatCompletion({
            choices: [{ finish_reason: "content_filter", message: { content: "" } }],
        }), (error: unknown) => error instanceof AgentError && error.statusCode === 502);
    });
});

describe("runAgentLoop", () => {
    it("returns a direct answer without tools", async () => {
        let executions = 0;
        const answer = await runAgentLoop(ask("父项是谁？"), runtime({
            async complete() {
                return { content: "还没有定位到节点。", toolCalls: [] };
            },
            async execute() {
                executions += 1;
                return okResult();
            },
        }));
        assert.equal(answer.answer, "还没有定位到节点。");
        assert.equal(executions, 0);
        assert.deepEqual(answer.steps, []);
    });

    it("feeds a tool result back before answering", async () => {
        const seen: ChatMessage[] = [];
        const answer = await runAgentLoop(ask("ABC-12 阻塞了谁？", "work_item:abc"), runtime({
            async complete(messages) {
                seen.push(...messages.filter((message) => message.role === "tool" || message.role === "user"));
                const tools = messages.filter((message) => message.role === "tool");
                if (tools.length === 0) {
                    return {
                        content: null,
                        toolCalls: [{ id: "call-1", name: "get_relations", arguments: "{\"nodeId\":\"work_item:abc\",\"types\":[\"blocks\"]}" }],
                    };
                }
                return { content: "ABC-12 没有阻塞别人。", toolCalls: [] };
            },
            async execute(command: ToolCommand) {
                assert.equal(command.name, "get_relations");
                return { ok: true, summary: "0 条边，1 个节点", body: { edges: [] } };
            },
        }));
        assert.equal(answer.answer, "ABC-12 没有阻塞别人。");
        assert.deepEqual(answer.steps, [{ tool: "get_relations", ok: true, summary: "0 条边，1 个节点" }]);
        assert.equal(seen.some((message) => message.role === "user" && message.content.includes("work_item:abc")), true);
    });

    it("returns tool argument errors to the model", async () => {
        let executed = false;
        const answer = await runAgentLoop(ask("看看"), runtime({
            async complete(messages) {
                const tool = messages.find((message) => message.role === "tool");
                if (!tool) {
                    return { content: null, toolCalls: [{ id: "call-1", name: "missing", arguments: "{}" }] };
                }
                assert.match(tool.content, /未知工具/);
                return { content: "没有这个工具。", toolCalls: [] };
            },
            async execute() {
                executed = true;
                return okResult();
            },
        }));
        assert.equal(executed, false);
        assert.equal(answer.steps[0]?.ok, false);
    });

    it("stops calling tools after the round limit", async () => {
        const toolCounts: number[] = [];
        const answer = await runAgentLoop(ask("展开全部影响"), runtime({
            async complete(_messages, tools) {
                toolCounts.push(tools.length);
                if (tools.length === 0) {
                    return { content: "先停在已查到的关系上。", toolCalls: [] };
                }
                return {
                    content: null,
                    toolCalls: [{ id: "call-1", name: "search_nodes", arguments: "{\"query\":\"登录\"}" }],
                };
            },
            async execute() {
                return okResult();
            },
        }), 1);
        assert.deepEqual(toolCounts, [3, 0]);
        assert.equal(answer.answer, "先停在已查到的关系上。");
        assert.equal(answer.steps.length, 1);
    });

    it("places history before the current question", async () => {
        const input = ask("那子项呢？", "work_item:abc");
        input.messages = [
            { role: "user", content: "父项是谁？" },
            { role: "assistant", content: "CSZB-3 是父项。" },
        ];
        const seen: ChatMessage[] = [];
        await runAgentLoop(input, runtime({
            async complete(messages) {
                seen.push(...messages);
                return { content: "子项还没查到。", toolCalls: [] };
            },
            async execute() {
                return okResult();
            },
        }));
        const users = seen.filter((message) => message.role === "user");
        assert.equal(users[0]?.content, "父项是谁？");
        assert.match(users[1]?.content ?? "", /work_item:abc/);
        assert.match(users[1]?.content ?? "", /那子项呢/);
    });

    it("drops history that does not fit and says so", async () => {
        const input = ask("父项是谁？");
        input.messages = [
            { role: "user", content: "之前问过阻塞" },
            { role: "assistant", content: "没有阻塞。" },
        ];
        const bare: ChatMessage[] = [
            { role: "system", content: GRAPH_AGENT_PROMPT },
            { role: "user", content: "父项是谁？" },
        ];
        const budget = Math.ceil(contextTokens(bare, GRAPH_AGENT_TOOLS));
        let sawHistory = false;
        const answer = await runAgentLoop(input, runtime({
            async complete(messages) {
                sawHistory = messages.some((message) => message.role === "user" && message.content === "之前问过阻塞");
                return { content: "父项是 CSZB-3。", toolCalls: [] };
            },
            async execute() {
                return okResult();
            },
        }), undefined, budget);
        assert.equal(sawHistory, false);
        assert.match(answer.answer, /CSZB-3/);
        assert.match(answer.answer, /较早的对话已不在上下文中/);
    });

    it("drops the oldest tool exchange before history", async () => {
        const input = ask("继续");
        input.messages = [
            { role: "user", content: "父项是谁？" },
            { role: "assistant", content: "CSZB-3 是父项。" },
        ];
        const seeded: ChatMessage[] = [
            { role: "system", content: GRAPH_AGENT_PROMPT },
            { role: "user", content: "父项是谁？" },
            { role: "assistant", content: "CSZB-3 是父项。" },
            { role: "user", content: "继续" },
        ];
        const budget = Math.ceil(contextTokens(seeded, GRAPH_AGENT_TOOLS));
        const sawTool: boolean[] = [];
        let round = 0;
        const answer = await runAgentLoop(input, runtime({
            async complete(messages) {
                sawTool.push(messages.some((message) => message.role === "tool"));
                round += 1;
                if (round === 1) {
                    return {
                        content: null,
                        toolCalls: [{ id: "call-1", name: "search_nodes", arguments: "{\"query\":\"登录\"}" }],
                    };
                }
                return { content: "沿用上一轮的父项结论。", toolCalls: [] };
            },
            async execute() {
                return { ok: true, summary: "大结果", body: { text: "x".repeat(8000) } };
            },
        }), undefined, budget);
        assert.deepEqual(sawTool, [false, false]);
        assert.match(answer.answer, /沿用上一轮/);
        assert.doesNotMatch(answer.answer, /较早的对话/);
    });

    it("stops when the current question still does not fit", async () => {
        let calls = 0;
        const answer = await runAgentLoop(ask("父项是谁？"), runtime({
            async complete() {
                calls += 1;
                return { content: "不会被调用。", toolCalls: [] };
            },
            async execute() {
                return okResult();
            },
        }), undefined, 1);
        assert.equal(calls, 0);
        assert.equal(answer.answer, "上下文过长，请新开一轮");
    });
});

function ask(question: string, focusNodeId?: string): AskInput {
    const input: AskInput = { question, messages: [] };
    if (focusNodeId) {
        input.focusNodeId = focusNodeId;
    }
    return input;
}

function runtime(partial: AgentRuntime): AgentRuntime {
    return partial;
}

function okResult(): ToolResult {
    return { ok: true, summary: "命中 1 个节点", body: { matches: [] } };
}
