/** Single-use, sender-bound answers for dsh's published approval and question seams. */
import { randomBytes } from 'node:crypto'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { IncomingMessage } from './protocol.ts'
import type { Card, MessageTransport } from './feishu-api.ts'
import type { CardAction } from './feishu-events.ts'
import { feedbackCopy, textCard } from './task-feedback.ts'
import type { Locale } from './messages.ts'

interface Pending {
  source: IncomingMessage
  messageId?: string
  accept(event: CardAction): boolean
}

/** Validate every submitted option against the exact question; form values are untrusted. */
export function decodeAnswers(questions: AskUserQuestionItem[], form: Record<string, unknown>): AskUserQuestionAnswer {
  return { answers: questions.map((question, index) => {
    const raw = form[`q${index}`]
    const values: unknown[] = raw === undefined || raw === '' ? [] : Array.isArray(raw) ? raw : [raw]
    if (!question.multiSelect && values.length > 1) throw new Error('Too many choices')
    const selected = [...new Set(values.map(value => {
      if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Invalid choice')
      const option = question.options?.[Number(value)]
      if (!option) throw new Error('Unknown choice')
      return option.label
    }))]
    const custom = form[`custom${index}`]
    if (custom !== undefined && (typeof custom !== 'string' || custom.length > 4000)) throw new Error('Invalid answer')
    const text = typeof custom === 'string' ? custom.trim() : ''
    if (!selected.length && !text) throw new Error('Answer required')
    if (question.intent?.kind === 'plan-review' && (selected.length !== 1 || text)) throw new Error('Choose a plan decision')
    return { id: question.id, selected, ...(text ? { custom: text } : {}) }
  }) }
}

export class CardInteractions {
  private readonly pending = new Map<string, Pending>()
  private readonly owned = new Set<Promise<unknown>>()
  private readonly lifetime = new AbortController()
  private readonly copy

  constructor(private readonly transport: MessageTransport, private readonly appId: string,
    locale: Locale, private readonly timeoutMs: number) { this.copy = feedbackCopy[locale] }

  receive(event: CardAction): boolean {
    if (this.lifetime.signal.aborted || event.appId !== this.appId || typeof event.value.request !== 'string') return false
    const pending = this.pending.get(event.value.request)
    if (!pending || pending.messageId !== event.messageId || pending.source.chatId !== event.chatId || pending.source.senderId !== event.senderId) return false
    return pending.accept(event)
  }

  private async ask<T>(source: IncomingMessage, build: (token: string) => Card,
    decode: (event: CardAction) => T, signal?: AbortSignal): Promise<T> {
    if (this.pending.size >= 16) throw new Error('feishu-im: too many pending decisions')
    const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])])
    combined.throwIfAborted()
    const token = randomBytes(24).toString('hex'), result = Promise.withResolvers<T>()
    // Attach before sending the card: cancellation while delivery is pending must be observed.
    void result.promise.catch(() => {})
    const abort = () => { this.pending.delete(token); result.reject(new Error('feishu-im: decision cancelled or expired')) }
    combined.addEventListener('abort', abort, { once: true })
    const pending: Pending = { source, accept: event => {
      let answer: T
      try { answer = decode(event) } catch { return false }
      this.pending.delete(token); result.resolve(answer); return true
    } }
    this.pending.set(token, pending)
    let accepted = false
    const work = (async () => {
      try {
        const card = build(token)
        if (Buffer.byteLength(JSON.stringify(card)) > 28_000) throw new Error('feishu-im: decision too large for a card')
        pending.messageId = await this.transport.card(source.messageId, `decision:${token}`, card, combined)
        const answer = await result.promise; accepted = true; return answer
      } finally {
        this.pending.delete(token); combined.removeEventListener('abort', abort)
        if (pending.messageId && !this.lifetime.signal.aborted) {
          await this.transport.updateCard(pending.messageId,
            textCard(accepted ? this.copy.submitted : this.copy.expired, accepted ? this.copy.submitted : this.copy.expired, 'grey'),
            this.lifetime.signal).catch(() => { process.stderr.write('feishu-im: decision card update failed\n') })
        }
      }
    })()
    this.owned.add(work)
    try { return await work } finally { this.owned.delete(work) }
  }

  async approve(source: IncomingMessage, request: ApprovalRequest, args?: string): Promise<ApprovalOutcome> {
    try {
      if (request.callId && args === undefined) return 'unavailable'
      const detail = `${request.toolName}\n\n${request.reason ?? ''}${args ? `\n\n\`\`\`json\n${args}\n\`\`\`` : ''}`
      if (detail.length > 10_000) return 'unavailable'
      return await this.ask(source, token => textCard(this.copy.waiting, detail,
        'orange', [
          { tag: 'button', text: { tag: 'plain_text', content: this.copy.allow }, type: 'primary', value: { request: token, choice: 'allow' } },
          { tag: 'button', text: { tag: 'plain_text', content: this.copy.reject }, type: 'danger', value: { request: token, choice: 'reject' } },
        ]), event => {
        if (event.value.choice === 'allow') return 'allowed-once'
        if (event.value.choice === 'reject') return 'rejected'
        throw new Error('Invalid decision')
      }, request.signal)
    } catch { return request.signal?.aborted || this.lifetime.signal.aborted ? 'cancelled' : 'unavailable' }
  }

  question(source: IncomingMessage, request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    return this.ask(source, token => {
      const elements: Card[] = []
      if (request.questions.length > 10) throw new Error('feishu-im: too many questions')
      for (const [index, question] of request.questions.entries()) {
        if ((question.options?.length ?? 0) > 50) throw new Error('feishu-im: too many choices')
        elements.push({ tag: 'markdown', content: [question.header, question.question, question.detail].filter(Boolean).join('\n\n') })
        if (question.options?.length) elements.push({ tag: question.multiSelect ? 'multi_select_static' : 'select_static', name: `q${index}`,
          placeholder: { tag: 'plain_text', content: question.question.slice(0, 80) },
          options: question.options.map((option, optionIndex) => ({ text: { tag: 'plain_text', content: option.label }, value: String(optionIndex) })) })
        if (question.options) for (const option of question.options) {
          if (option.description) elements.push({ tag: 'markdown', content: `${option.label}: ${option.description}` })
        }
        if (!question.intent) elements.push({ tag: 'input', name: `custom${index}`, placeholder: { tag: 'plain_text', content: this.copy.custom } })
      }
      elements.push({ tag: 'button', name: 'submit', form_action_type: 'submit', type: 'primary',
        text: { tag: 'plain_text', content: this.copy.submit }, value: { request: token } })
      return textCard(this.copy.waiting, this.copy.waiting, 'orange', [{ tag: 'form', name: 'questions', elements }])
    }, event => decodeAnswers(request.questions, event.form), request.signal)
  }

  async dispose(): Promise<void> { this.lifetime.abort(); await Promise.allSettled(this.owned) }
}
