import type { NexusAppContext } from "@pc-nexus/core";
import { executeGraphTool } from "./catalog.js";
import { AgentError, normalizeAskInput, type AgentAnswer } from "./contract.js";
import { completeChat, readDeepSeekApiKey } from "./deepseek.js";
import { runAgentLoop } from "./loop.js";

export async function answerGraphQuestion(context: NexusAppContext, raw: unknown): Promise<AgentAnswer> {
    const input = normalizeAskInput(raw);
    const apiKey = readDeepSeekApiKey();
    if (!apiKey) {
        throw new AgentError("未配置 DEEPSEEK_API_KEY", 503);
    }
    return runAgentLoop(input, {
        complete: (messages, tools) => completeChat(apiKey, messages, tools),
        execute: (command) => executeGraphTool(context, command),
    });
}
