import { fetch } from "@pc-nexus/network";
import { AgentError, type ChatMessage, type FunctionTool, type ModelMessage } from "./contract.js";

const CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-flash";
const REQUEST_TIMEOUT_MS = 30_000;

export function readDeepSeekApiKey(): string | undefined {
    const key = process.env["DEEPSEEK_API_KEY"]?.trim();
    return key ? key : undefined;
}

export async function completeChat(
    apiKey: string,
    messages: ChatMessage[],
    tools: readonly FunctionTool[],
): Promise<ModelMessage> {
    const body: Record<string, unknown> = {
        model: MODEL,
        messages,
        temperature: 0.2,
        stream: false,
        thinking: { type: "disabled" },
    };
    if (tools.length > 0) {
        body["tools"] = tools;
        body["tool_choice"] = "auto";
    }

    let response: Response;
    console.log(JSON.stringify(body), apiKey);
    try {
        response = await fetch.request(CHAT_COMPLETIONS_URL, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
                "accept-encoding": "gzip;q=0, deflate;q=0, br;q=0, identity",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
            throw new AgentError("DeepSeek 响应超时", 504);
        }
        throw new AgentError("DeepSeek 暂时无法连接", 502);
    }

    if (!response.ok) {
        const detail = await readErrorDetail(response);
        throw new AgentError(`DeepSeek 请求失败（${response.status}）${detail ? `：${detail}` : ""}`, 502);
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch (error: any) {
        console.error("name:", error.name);
        console.error("message:", error.message);
        console.error("cause:", error.cause);
        console.error("cause code:", error.cause?.code);
        console.error("cause message:", error.cause?.message);
        throw new AgentError("DeepSeek 返回的不是 JSON", 502);
    }
    return parseChatCompletion(payload);
}

export function parseChatCompletion(payload: unknown): ModelMessage {
    if (!isRecord(payload) || !Array.isArray(payload["choices"]) || payload["choices"].length === 0) {
        throw new AgentError("DeepSeek 没有返回 choices", 502);
    }
    const choice = payload["choices"][0];
    if (!isRecord(choice) || !isRecord(choice["message"])) {
        throw new AgentError("DeepSeek 没有返回 message", 502);
    }
    const finishReason = typeof choice["finish_reason"] === "string" ? choice["finish_reason"] : undefined;
    if (finishReason === "content_filter") {
        throw new AgentError("回答被内容安全策略拦截", 502);
    }
    if (finishReason === "insufficient_system_resource") {
        throw new AgentError("模型资源不足，请稍后再试", 503);
    }

    const message = choice["message"];
    const content = typeof message["content"] === "string" || message["content"] === null ? message["content"] : null;
    const toolCalls = readToolCalls(message["tool_calls"]);
    const modelMessage: ModelMessage = { content, toolCalls };
    if (finishReason !== undefined) {
        modelMessage.finishReason = finishReason;
    }
    return modelMessage;
}

async function readErrorDetail(response: Response): Promise<string> {
    const text = await response.text();
    try {
        const body = JSON.parse(text) as { error?: { message?: string } };
        if (typeof body.error?.message === "string") {
            return body.error.message.slice(0, 300);
        }
    } catch {
        // 非 JSON 错误体只截取原文
    }
    return text.trim().slice(0, 300);
}

function readToolCalls(value: unknown): ModelMessage["toolCalls"] {
    if (!Array.isArray(value)) {
        return [];
    }
    const calls: ModelMessage["toolCalls"] = [];
    for (const item of value) {
        if (!isRecord(item) || typeof item["id"] !== "string" || !isRecord(item["function"])) {
            continue;
        }
        const name = item["function"]["name"];
        const args = item["function"]["arguments"];
        if (typeof name !== "string") {
            continue;
        }
        calls.push({
            id: item["id"],
            name,
            arguments: typeof args === "string" ? args : "{}",
        });
    }
    return calls;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
