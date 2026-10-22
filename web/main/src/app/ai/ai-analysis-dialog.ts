import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ThyAction } from 'ngx-tethys/action';
import { ThyButtonModule } from 'ngx-tethys/button';
import { ThyDialogRef } from 'ngx-tethys/dialog';
import { ThyContent, ThyHeader, ThyLayout } from 'ngx-tethys/layout';
import { ThyLoading } from 'ngx-tethys/loading';
import { ANALYSIS_QUESTION } from './analysis-question';
import { agentErrorMessage, askGraphAgent } from './ask-graph-agent';
import { renderAnswerMarkdown } from './render-answer-markdown';

@Component({
  selector: 'app-ai-analysis-dialog',
  imports: [ThyAction, ThyButtonModule, ThyLayout, ThyHeader, ThyContent, ThyLoading],
  templateUrl: './ai-analysis-dialog.html',
  styleUrl: './ai-analysis-dialog.scss',
})
export class AiAnalysisDialog implements OnInit {
  /** ThyDialog 打开前写入，ngOnInit 里用来提问。 */
  focusNodeId = '';

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly answer = signal<string | null>(null);
  protected readonly answerHtml = computed(() => renderAnswerMarkdown(this.answer() ?? ''));

  private readonly dialogRef = inject(ThyDialogRef);

  ngOnInit(): void {
    void this.load();
  }

  protected close(): void {
    this.dialogRef.close();
  }

  protected retry(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const focusNodeId = this.focusNodeId.trim();
    this.loading.set(true);
    this.error.set(null);

    if (!focusNodeId) {
      this.answer.set(null);
      this.error.set('缺少当前工作项');
      this.loading.set(false);
      return;
    }

    try {
      const result = await askGraphAgent({ question: ANALYSIS_QUESTION, focusNodeId });
      this.answer.set(result.answer);
      this.error.set(null);
    } catch (error) {
      this.answer.set(null);
      this.error.set(agentErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
