import {
    GRAPH_AGENT_TOOLS,
    MAX_CONTEXT_TOKENS,
    MAX_TOOL_ROUNDS,
    clipToolContent,
    parseToolCall,
    type AgentAnswer,
    type AgentStep,
    type AskInput,
    type ChatMessage,
    type FunctionTool,
    type ModelMessage,
    type ToolCommand,
    type ToolResult,
} from "./contract.js";
import { GRAPH_AGENT_PROMPT } from "./prompt.js";

const OVERFLOW_ANSWER = "上下文过长，请新开一轮";
const HISTORY_NOTE = "较早的对话已不在上下文中";

export interface AgentRuntime {
    complete(messages: ChatMessage[], tools: readonly FunctionTool[]): Promise<ModelMessage>;
    execute(command: ToolCommand): Promise<ToolResult>;
}

export async function runAgentLoop(
    input: AskInput,
    runtime: AgentRuntime,
    maxToolRounds: number = MAX_TOOL_ROUNDS,
    maxContextTokens: number = MAX_CONTEXT_TOKENS,
): Promise<AgentAnswer> {
    const messages: ChatMessage[] = [{ role: "system", content: GRAPH_AGENT_PROMPT }];
    for (const message of input.messages) {
        messages.push({ role: message.role, content: message.content });
    }
    messages.push({
        role: "user",
        content: input.focusNodeId ? `当前焦点节点：${input.focusNodeId}\n\n${input.question}` : input.question,
    });

    let droppedHistory = false;
    const fit = (tools: readonly FunctionTool[]): boolean => {
        const fitted = fitContext(messages, tools, maxContextTokens);
        if (fitted.droppedHistory) {
            droppedHistory = true;
        }
        messages.splice(0, messages.length, ...fitted.messages);
        return contextTokens(messages, tools) <= maxContextTokens;
    };
    const answerWithNote = (message: ModelMessage): string => {
        const answer = finishAnswer(message);
        if (!droppedHistory) {
            return answer;
        }
        return `${answer}\n\n${HISTORY_NOTE}`;
    };

    const steps: AgentStep[] = [];
    for (let round = 0; round < maxToolRounds; round++) {
        if (!fit(GRAPH_AGENT_TOOLS)) {
            return { answer: OVERFLOW_ANSWER, steps };
        }
        const message = await runtime.complete(messages, GRAPH_AGENT_TOOLS);
        if (message.toolCalls.length === 0) {
            return { answer: answerWithNote(message), steps };
        }
        messages.push(toAssistantMessage(message));
        for (const call of message.toolCalls) {
            const outcome = await runTool(call.name, call.arguments, runtime);
            steps.push({ tool: call.name, ok: outcome.ok, summary: outcome.summary });
            messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: clipToolContent(outcome.body),
            });
        }
    }

    messages.push({
        role: "system",
        content: "已达到工具调用次数上限。请只根据上面的工具结果回答，不要再调用工具。查不到的部分直接说明。",
    });
    if (!fit([])) {
        return { answer: OVERFLOW_ANSWER, steps };
    }
    const finalMessage = await runtime.complete(messages, []);
    return { answer: answerWithNote(finalMessage), steps };
}

/** 系统提示、工具 schema、历史、当前问题和本轮工具结果共用 32K token。超出时先丢掉最早的工具往返，再丢掉最早的一组历史问答。 */
export function fitContext(
    messages: readonly ChatMessage[],
    tools: readonly FunctionTool[],
    budget: number,
): { messages: ChatMessage[]; droppedHistory: boolean } {
    const next = messages.slice();
    let droppedHistory = false;
    while (contextTokens(next, tools) > budget) {
        if (dropOldestToolExchange(next)) {
            continue;
        }
        if (dropOldestHistoryPair(next)) {
            droppedHistory = true;
            continue;
        }
        break;
    }
    return { messages: next, droppedHistory };
}

/** 汉字按 0.6 token/字、其余字符按 0.3 token/字估算，与 DeepSeek 的粗算一致。 */
export function contextTokens(messages: readonly ChatMessage[], tools: readonly FunctionTool[]): number {
    const text = messages.map(messageText).join("") + (tools.length > 0 ? JSON.stringify(tools) : "");
    return estimateTokens(text);
}

async function runTool(name: string, rawArguments: string, runtime: AgentRuntime): Promise<ToolResult> {
    const parsed = parseToolCall(name, rawArguments);
    if ("error" in parsed) {
        return { ok: false, summary: parsed.error, body: { error: parsed.error } };
    }
    try {
        return await runtime.execute(parsed.command);
    } catch {
        return { ok: false, summary: "工具执行失败", body: { error: "工具执行失败" } };
    }
}

function finishAnswer(message: ModelMessage): string {
    const answer = message.content?.trim();
    if (!answer) {
        return "没有根据图谱得出结论。请换一个更具体的节点或关系再问。";
    }
    if (message.finishReason === "length") {
        return `${answer}\n\n（回答因长度限制被截断）`;
    }
    return answer;
}

function toAssistantMessage(message: ModelMessage): Extract<ChatMessage, { role: "assistant" }> {
    const assistant: Extract<ChatMessage, { role: "assistant" }> = {
        role: "assistant",
        content: message.content,
    };
    if (message.toolCalls.length > 0) {
        assistant.tool_calls = message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
        }));
    }
    return assistant;
}

function dropOldestToolExchange(messages: ChatMessage[]): boolean {
    const start = messages.findIndex(
        (message) => message.role === "assistant" && (message.tool_calls?.length ?? 0) > 0,
    );
    if (start < 0) {
        return false;
    }
    let end = start + 1;
    while (messages[end]?.role === "tool") {
        end += 1;
    }
    messages.splice(start, end - start);
    return true;
}

function dropOldestHistoryPair(messages: ChatMessage[]): boolean {
    const first = messages[1];
    const second = messages[2];
    if (first?.role !== "user" || second?.role !== "assistant") {
        return false;
    }
    if ((second.tool_calls?.length ?? 0) > 0) {
        return false;
    }
    const laterUser = messages.slice(3).some((message) => message.role === "user");
    if (!laterUser) {
        return false;
    }
    messages.splice(1, 2);
    return true;
}

function messageText(message: ChatMessage): string {
    if (message.role === "assistant") {
        const calls = (message.tool_calls ?? []).map((call) => call.function.name + call.function.arguments).join("");
        return `${message.content ?? ""}${calls}`;
    }
    return message.content;
}

function estimateTokens(text: string): number {
    let han = 0;
    let other = 0;
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        if (code >= 0x4e00 && code <= 0x9fff) {
            han += 1;
        } else {
            other += 1;
        }
    }
    return han * 0.6 + other * 0.3;
}
