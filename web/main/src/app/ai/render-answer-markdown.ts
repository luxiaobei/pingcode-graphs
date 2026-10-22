import { Marked } from 'marked';

const answerMarked = new Marked({ gfm: true, breaks: false });

answerMarked.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

/** 把模型返回的 Markdown 原文转成 HTML。原文里的 HTML 标签按文本转义。 */
export function renderAnswerMarkdown(markdown: string): string {
  return answerMarked.parse(markdown, { async: false }) as string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
