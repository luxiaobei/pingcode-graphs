import { Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ThyAction } from 'ngx-tethys/action';
import { ThyButtonModule } from 'ngx-tethys/button';
import { ThyDialogRef } from 'ngx-tethys/dialog';
import { ThyIcon } from 'ngx-tethys/icon';
import { ThyContent, ThyHeader, ThyLayout } from 'ngx-tethys/layout';
import { ANALYSIS_QUESTION } from './analysis-question';
import { agentErrorMessage, askGraphAgent, type AgentHistoryMessage } from './ask-graph-agent';
import { renderAnswerMarkdown } from './render-answer-markdown';

/** 输入框最多 2000 字。历史里单条也按这个长度截断，避免接口拒收。 */
const MAX_INPUT_LENGTH = 2000;

/** 打开弹窗时气泡上的短句。发给接口的是 ANALYSIS_QUESTION。 */
const OPENING_BUBBLE = '分析当前焦点工作项的进展';

type TurnStatus = 'pending' | 'done' | 'error' | 'stopped';

/** 一轮对话：bubble 在右侧，question 发给接口，answer 在左侧。 */
interface ChatTurn {
  id: number;
  bubble: string;
  question: string;
  answer: string | null;
  error: string | null;
  status: TurnStatus;
}

@Component({
  selector: 'app-ai-analysis-dialog',
  imports: [FormsModule, ThyAction, ThyButtonModule, ThyIcon, ThyLayout, ThyHeader, ThyContent],
  templateUrl: './ai-analysis-dialog.html',
  styleUrl: './ai-analysis-dialog.scss',
})
export class AiAnalysisDialog implements OnInit {
  /** ThyDialog 打开前写入，每一轮都传给接口。 */
  focusNodeId = '';

  protected draft = '';
  protected readonly maxInputLength = MAX_INPUT_LENGTH;
  protected readonly turns = signal<ChatTurn[]>([]);
  protected readonly busy = computed(() => this.turns().some((turn) => turn.status === 'pending'));

  private readonly dialogRef = inject(ThyDialogRef);
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  /** 停止或新开一轮后加一，晚回来的结果对不上就丢掉。 */
  private requestSeq = 0;
  private nextTurnId = 0;

  ngOnInit(): void {
    void this.send(OPENING_BUBBLE, ANALYSIS_QUESTION);
  }

  protected close(): void {
    this.dialogRef.close();
  }

  protected canSend(): boolean {
    return !this.busy() && this.draft.trim().length > 0;
  }

  /** Enter 发送。Shift+Enter 换行。输入法选词时不发送。 */
  protected onDraftKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }
    event.preventDefault();
    this.sendDraft();
  }

  protected sendDraft(): void {
    const text = this.draft.trim().slice(0, MAX_INPUT_LENGTH);
    if (!text || this.busy()) {
      return;
    }
    this.draft = '';
    void this.send(text, text);
  }

  protected retry(id: number): void {
    const turn = this.turns().find((item) => item.id === id);
    if (!turn || this.busy()) {
      return;
    }
    void this.send(turn.bubble, turn.question, turn.id);
  }

  protected stop(): void {
    if (!this.busy()) {
      return;
    }
    this.requestSeq += 1;
    this.mapTurns((turn) => (turn.status === 'pending' ? { ...turn, status: 'stopped' } : turn));
  }

  protected answerHtml(turn: ChatTurn): string {
    return renderAnswerMarkdown(turn.answer ?? '');
  }

  /** bubble 显示在右侧。question 发给接口。传入 id 时重试这一轮。 */
  private async send(bubble: string, question: string, id?: number): Promise<void> {
    const seq = ++this.requestSeq;
    const turnId = id ?? ++this.nextTurnId;
    const focusNodeId = this.focusNodeId.trim();
    const messages = historyBefore(this.turns(), turnId);

    this.saveTurn({ id: turnId, bubble, question, answer: null, error: null, status: 'pending' });
    this.scrollToEnd();

    if (!focusNodeId) {
      this.finish(seq, turnId, { status: 'error', error: '缺少当前工作项', answer: null });
      return;
    }

    try {
      const result = await askGraphAgent({
        question,
        focusNodeId,
        ...(messages.length ? { messages } : {}),
      });
      this.finish(seq, turnId, { status: 'done', error: null, answer: result.answer });
    } catch (error) {
      this.finish(seq, turnId, { status: 'error', error: agentErrorMessage(error), answer: null });
    }
  }

  private finish(seq: number, id: number, patch: Pick<ChatTurn, 'status' | 'error' | 'answer'>): void {
    if (seq !== this.requestSeq) {
      return;
    }
    this.mapTurns((turn) => (turn.id === id ? { ...turn, ...patch } : turn));
    this.scrollTurnToTop(id);
  }

  private saveTurn(next: ChatTurn): void {
    this.turns.update((list) =>
      list.some((turn) => turn.id === next.id)
        ? list.map((turn) => (turn.id === next.id ? next : turn))
        : [...list, next],
    );
  }

  private mapTurns(change: (turn: ChatTurn) => ChatTurn): void {
    this.turns.update((list) => list.map(change));
  }

  private scrollToEnd(): void {
    this.scrollThread((thread) => {
      thread.scrollTop = thread.scrollHeight;
    });
  }

  /** 结论出来后停在这一轮的问题上，回答紧跟在下面。 */
  private scrollTurnToTop(id: number): void {
    this.scrollThread((thread) => {
      const turn = thread.querySelector<HTMLElement>(`[data-turn-id="${id}"]`);
      if (!turn) {
        return;
      }
      const padding = Number.parseFloat(getComputedStyle(thread).paddingTop) || 0;
      thread.scrollTop = Math.max(0, turn.offsetTop - padding);
    });
  }

  private scrollThread(place: (thread: HTMLElement) => void): void {
    setTimeout(() => {
      const thread = this.thread()?.nativeElement;
      if (thread) {
        place(thread);
      }
    });
  }
}

/** 这一轮之前已经完成的问答。失败和已停止的不带上。 */
function historyBefore(turns: readonly ChatTurn[], beforeId: number): AgentHistoryMessage[] {
  const messages: AgentHistoryMessage[] = [];
  for (const turn of turns) {
    if (turn.id === beforeId) {
      break;
    }
    if (turn.status !== 'done' || !turn.answer?.trim() || !turn.question.trim()) {
      continue;
    }
    messages.push({ role: 'user', content: cut(turn.question) }, { role: 'assistant', content: cut(turn.answer) });
  }
  return messages;
}

function cut(text: string): string {
  return text.length > MAX_INPUT_LENGTH ? text.slice(0, MAX_INPUT_LENGTH) : text;
}
