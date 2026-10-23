import { invoke } from '@pc-nexus/bridge';

/** 一次工具调用的结果。界面不展示，只和后端返回对齐。 */
export interface AgentStep {
  tool: string;
  ok: boolean;
  summary: string;
}

/** askGraphAgent 的返回。弹窗只展示 answer。 */
export interface AgentAnswer {
  answer: string;
  steps: AgentStep[];
}

/** 本轮之前的对话。 */
export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskGraphAgentPayload {
  question: string;
  focusNodeId?: string;
  messages?: AgentHistoryMessage[];
}

/** 向关系图谱助手提问。 */
export function askGraphAgent(payload: AskGraphAgentPayload): Promise<AgentAnswer> {
  return invoke<AskGraphAgentPayload, AgentAnswer>('askGraphAgent', payload);
}

export function agentErrorMessage(error: unknown): string {
  const message = readErrorMessage(error).trim();
  return message || '分析失败';
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '';
}
