import {
    GRAPH_AGENT_TOOLS,
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

export interface AgentRuntime {
    complete(messages: ChatMessage[], tools: readonly FunctionTool[]): Promise<ModelMessage>;
    execute(command: ToolCommand): Promise<ToolResult>;
}

export async function runAgentLoop(
    input: AskInput,
    runtime: AgentRuntime,
    maxToolRounds: number = MAX_TOOL_ROUNDS,
): Promise<AgentAnswer> {
    const messages: ChatMessage[] = [{ role: "system", content: GRAPH_AGENT_PROMPT }];
    for (const message of input.messages) {
        messages.push({ role: message.role, content: message.content });
    }
    messages.push({
        role: "user",
        content: input.focusNodeId ? `当前焦点节点：${input.focusNodeId}\n\n${input.question}` : input.question,
    });

    const steps: AgentStep[] = [];
    for (let round = 0; round < maxToolRounds; round++) {
        const message = await runtime.complete(messages, GRAPH_AGENT_TOOLS);
        if (message.toolCalls.length === 0) {
            return { answer: finishAnswer(message), steps };
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
    const finalMessage = await runtime.complete(messages, []);
    return { answer: finishAnswer(finalMessage), steps };
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
