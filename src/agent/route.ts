import type { ApiRouteHandler, ApiRouteResponse } from "@pc-nexus/core";
import { AgentError } from "./contract.js";
import { answerGraphQuestion } from "./service.js";

export const askGraphAgent: ApiRouteHandler = async (context, request) => {
    try {
        const answer = await answerGraphQuestion(context, readJsonBody(request.body));
        return json(200, answer);
    } catch (error) {
        const statusCode = error instanceof AgentError ? error.statusCode : 500;
        const message = error instanceof AgentError ? error.message : "图谱助手暂时无法回答";
        return json(statusCode, { message });
    }
};

function readJsonBody(body: unknown): unknown {
    if (typeof body !== "string") {
        return body;
    }
    try {
        return JSON.parse(body);
    } catch {
        throw new AgentError("请求体不是 JSON", 400);
    }
}

function json(statusCode: number, body: unknown): ApiRouteResponse<unknown> {
    return {
        statusCode,
        headers: { "content-type": "application/json; charset=utf-8" },
        body,
    };
}
