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

export interface AskGraphAgentPayload {
  question: string;
  focusNodeId?: string;
}

/** 打开分析弹窗时直接问这一句，不让用户再填问题。 */
export const ANALYSIS_QUESTION = '帮我分析当前工作项的进展情况';

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
