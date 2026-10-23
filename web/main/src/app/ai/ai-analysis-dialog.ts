import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ThyAction } from 'ngx-tethys/action';
import { ThyButtonModule } from 'ngx-tethys/button';
import { ThyDialogRef } from 'ngx-tethys/dialog';
import { ThyInputModule } from 'ngx-tethys/input';
import { ThyContent, ThyHeader, ThyLayout } from 'ngx-tethys/layout';
import { ThyLoading } from 'ngx-tethys/loading';
import { ANALYSIS_QUESTION } from './analysis-question';
import { agentErrorMessage, askGraphAgent } from './ask-graph-agent';
import { renderAnswerMarkdown } from './render-answer-markdown';

/** 与后端 question 长度上限一致。 */
const MAX_QUESTION_LENGTH = 2000;

@Component({
  selector: 'app-ai-analysis-dialog',
  imports: [
    FormsModule,
    ThyAction,
    ThyButtonModule,
    ThyInputModule,
    ThyLayout,
    ThyHeader,
    ThyContent,
    ThyLoading,
  ],
  templateUrl: './ai-analysis-dialog.html',
  styleUrl: './ai-analysis-dialog.scss',
})
export class AiAnalysisDialog implements OnInit {
  /** ThyDialog 打开前写入，提问时一并传给接口。 */
  focusNodeId = '';

  /** 用户在输入框里写的问题。提交后作为 question 传给接口。 */
  protected prompt = '';

  protected readonly maxQuestionLength = MAX_QUESTION_LENGTH;
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly answer = signal<string | null>(null);
  protected readonly answerHtml = computed(() => renderAnswerMarkdown(this.answer() ?? ''));

  private readonly dialogRef = inject(ThyDialogRef);
  private lastQuestion = ANALYSIS_QUESTION;
  private requestSeq = 0;

  ngOnInit(): void {
    void this.ask(ANALYSIS_QUESTION);
  }

  protected close(): void {
    this.dialogRef.close();
  }

  protected retry(): void {
    void this.ask(this.lastQuestion);
  }

  protected canSubmit(): boolean {
    return !this.loading() && this.prompt.trim().length > 0;
  }

  /** Enter 发送。Shift+Enter 换行。中文输入法选词时不发送。 */
  protected onPromptKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }
    event.preventDefault();
    this.submit();
  }

  protected submit(): void {
    const question = this.prompt.trim().slice(0, MAX_QUESTION_LENGTH);
    if (!question || this.loading()) {
      return;
    }
    void this.ask(question);
  }

  private async ask(question: string): Promise<void> {
    const focusNodeId = this.focusNodeId.trim();
    const seq = ++this.requestSeq;
    this.lastQuestion = question;
    this.loading.set(true);
    this.error.set(null);

    if (!focusNodeId) {
      this.answer.set(null);
      this.error.set('缺少当前工作项');
      this.loading.set(false);
      return;
    }

    try {
      const result = await askGraphAgent({ question, focusNodeId });
      if (seq !== this.requestSeq) {
        return;
      }
      this.answer.set(result.answer);
      this.error.set(null);
    } catch (error) {
      if (seq !== this.requestSeq) {
        return;
      }
      this.answer.set(null);
      this.error.set(agentErrorMessage(error));
    } finally {
      if (seq === this.requestSeq) {
        this.loading.set(false);
      }
    }
  }
}
