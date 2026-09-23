/** Bounded milestone updates, containing public assistant text but no reasoning/tool payloads. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Card, MessageTransport } from './feishu-api.ts'
import type { Locale } from './messages.ts'

export const feedbackCopy = {
  'zh-CN': { working: '正在处理', thinking: '分析任务并规划下一步', tool: '执行工具', done: '工具已完成', failed: '工具执行失败',
    waiting: '等待你的确认', finished: '任务已结束', submitted: '已提交', expired: '请求已结束或过期', allow: '允许本次', reject: '拒绝', submit: '提交回答', custom: '补充或自定义回答' },
  en: { working: 'Working', thinking: 'Reviewing the task and planning the next step', tool: 'Running tool', done: 'Tool finished', failed: 'Tool failed',
    waiting: 'Waiting for your decision', finished: 'Task finished', submitted: 'Submitted', expired: 'Request closed or expired', allow: 'Allow once', reject: 'Reject', submit: 'Submit answer', custom: 'Additional or custom answer' },
} as const

export function textCard(title: string, text: string, template = 'blue', elements: Card[] = []): Card {
  return { schema: '2.0', config: { wide_screen_mode: true, update_multi: true },
    header: { title: { tag: 'plain_text', content: title }, template },
    body: { elements: [{ tag: 'markdown', content: text.slice(0, 10_000) || '…' }, ...elements] } }
}

export class TaskFeedback {
  private id?: string
  private readonly lines: string[] = []
  private readonly tools = new Map<string, { name: string; arguments: string }>()
  private timer?: ReturnType<typeof setTimeout>
  private running?: Promise<void>
  private pending?: Card
  private closed = false
  private readonly copy

  constructor(private readonly transport: MessageTransport, private readonly messageId: string,
    locale: Locale, private readonly interval: number, private readonly signal: AbortSignal) {
    this.copy = feedbackCopy[locale]
  }

  private queue(card: Card): void {
    this.pending = card
    this.running ??= Promise.resolve().then(async () => {
      while (this.pending) {
        const next = this.pending; this.pending = undefined
        try {
          this.signal.throwIfAborted()
          if (this.id) await this.transport.updateCard(this.id, next, this.signal)
          else this.id = await this.transport.card(this.messageId, 'progress', next, this.signal)
        } catch { if (!this.signal.aborted) process.stderr.write('feishu-im: progress delivery failed\n') }
      }
      this.running = undefined
    })
  }

  status(text: string): void {
    if (this.closed || this.signal.aborted) return
    this.lines.push(text.slice(0, 1200))
    if (this.lines.length > 8) this.lines.shift()
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      this.queue(textCard(this.copy.working, this.lines.join('\n\n')))
    }, this.interval)
  }

  observe(event: SessionEvent): void {
    if (this.closed) return
    if (event.type === 'step/start') this.status(this.copy.thinking)
    if (event.type === 'assistant/message') {
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      if (text.trim()) this.status(text)
    }
    if (event.type === 'tool/call') {
      if (this.tools.size >= 128) this.tools.delete(this.tools.keys().next().value!)
      this.tools.set(event.data.callId, { name: event.data.name, arguments: event.data.arguments })
      this.status(`${this.copy.tool}: ${event.data.name}`)
    }
    if (event.type === 'tool/result') {
      const tool = this.tools.get(event.data.message.toolCallId)
      this.status(`${event.data.message.isError ? this.copy.failed : this.copy.done}${tool ? `: ${tool.name}` : ''}`)
    }
  }

  toolArguments(callId?: string): string | undefined { return callId === undefined ? undefined : this.tools.get(callId)?.arguments }

  async finish(text: string): Promise<void> {
    this.closed = true; clearTimeout(this.timer)
    this.queue(textCard(this.copy.finished, [...this.lines, text.slice(0, 1200)].slice(-8).join('\n\n'), 'grey'))
    await this.running
  }

  async dispose(): Promise<void> {
    this.closed = true; clearTimeout(this.timer)
    await this.running
  }
}
