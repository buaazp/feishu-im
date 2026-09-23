/** Private-chat workers owning serialized Agent intervals and durable message deduplication. */

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { brandString } from '@deepseek-ai/dsh-brand'
import { errorChain, freezeMessage, type MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type { Config } from './config.ts'
import { conversationId, parseMessage, type IncomingMessage } from './protocol.ts'
import type { LarkCli } from './transport.ts'
import { messages, type Locale } from './messages.ts'

interface Worker {
  controller: AbortController
  queue: IncomingMessage[]
  seen: Set<string>
  handle?: AgentHandle
  closing: boolean
  done: Promise<void>
}

/**
 * Select committed assistant text and final outcome for one exclusive run interval.
 * @param events - observed durable events.
 * @param start - first sequence belonging to the submitted task.
 * @param locale - language for control replies when no final answer is available.
 * @returns user-facing text without reasoning or tool output.
 */
export function summarize(events: Iterable<SessionEvent>, start: SessionLogOffset, locale: Locale): string {
  const copy = messages[locale]
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  for (const event of events) {
    if (event.seq < start) continue
    if (event.type === 'assistant/message') {
      const content = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      if (content !== '') text = content
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  if (reason?.kind === 'completed') return text || copy.empty
  if (reason?.kind === 'aborted') return copy.stopped
  return copy.incomplete
}

/** Bounded private-chat driver; all scheduled work belongs to its lifetime. */
export class LarkDriver {
  private readonly workers = new Map<SessionId, Worker>()
  private readonly replies = new Set<Promise<void>>()
  private readonly lifetime = new AbortController()

  constructor(private readonly ctx: Context, private readonly config: Config, private readonly cli: LarkCli) {}

  /**
   * Validate and schedule one CLI record without blocking event consumption.
   * @param line - NDJSON record from the authenticated CLI consumer.
   */
  receive(line: string): void {
    if (this.lifetime.signal.aborted) return
    let message: IncomingMessage | undefined
    try {
      message = parseMessage(line)
    } catch (error: unknown) {
      process.stderr.write(`feishu-im: rejected event: ${errorChain(error)}` + '\n')
      return
    }
    if (message === undefined || !this.config.allowedUsers.includes(message.senderId)) return
    const id = conversationId(this.config.profile, this.config.cwd, message)
    const existing = this.workers.get(id)
    const command = message.text.trim()
    const copy = messages[this.config.locale]
    if (command === '/dsh stop') {
      if (existing !== undefined) {
        existing.closing = true
        existing.queue.length = 0
        existing.controller.abort()
        existing.handle?.agent.cancel({ kind: 'user' })
      }
      this.notify(message, 'stop', existing === undefined ? copy.noTask : copy.stopRequested)
      return
    }
    if (command === '/dsh status') {
      this.notify(message, 'status', existing === undefined ? copy.idle
        : `${existing.closing ? copy.stopping : copy.running} · ${copy.pending}: ${existing.queue.length}`)
      return
    }
    if (command === '/dsh' || command.startsWith('/dsh ')) {
      this.notify(message, 'help', copy.help)
      return
    }
    if (existing !== undefined) {
      if (existing.seen.has(message.messageId)) return
      if (existing.closing || existing.queue.length >= this.config.maxPendingMessages) {
        this.notify(message, 'busy', copy.busy)
        return
      }
      existing.seen.add(message.messageId)
      existing.queue.push(message)
      this.notify(message, 'queued', copy.queued)
      return
    }
    if (this.workers.size >= this.config.maxConversations) {
      this.notify(message, 'busy', copy.capacity)
      return
    }
    const worker: Worker = {
      controller: new AbortController(), queue: [message], seen: new Set([message.messageId]),
      closing: false, done: Promise.resolve(),
    }
    this.workers.set(id, worker)
    worker.done = this.run(id, worker).catch((error: unknown) => {
      if (!worker.controller.signal.aborted) {
        process.stderr.write(`feishu-im: conversation ${id} failed: ${errorChain(error)}` + '\n')
        this.notify(message, 'failure', copy.startupFailed)
      }
    }).finally(() => { this.workers.delete(id) })
  }

  private notify(message: IncomingMessage, phase: string, text: string): void {
    if (this.replies.size >= this.config.maxConcurrentReplies) {
      process.stderr.write('feishu-im: reply concurrency limit reached' + '\n')
      return
    }
    const task = this.cli.reply(message.messageId, phase, text, this.lifetime.signal)
      .catch((error: unknown) => {
        if (!this.lifetime.signal.aborted) process.stderr.write(`feishu-im: reply failed: ${errorChain(error)}` + '\n')
      }).finally(() => { this.replies.delete(task) })
    this.replies.add(task)
  }

  private async run(id: SessionId, worker: Worker): Promise<void> {
    const signal = worker.controller.signal
    try {
      if (this.ctx.agents.get(id) !== undefined) throw new Error('feishu-im: Session already has a live owner')
      const stored = await this.ctx.sessionPersistence.stat(id)
      signal.throwIfAborted()
      const selection = this.ctx.agentDefaultModel.currentSelection()
      const setup = (agentCtx: Context): void => {
        installModelSelection(agentCtx, { current: selection, assembled: undefined })
      }
      const options = { agentOptions: { provider: selection.provider, model: selection.model }, setup, signal }
      worker.handle = stored === undefined
        ? await this.ctx.agents.create({ ...options, sessionId: id, meta: { cwd: this.config.cwd } })
        : await this.ctx.agents.resume({ ...options, resumeSessionId: id })
      const agent = worker.handle.agent
      signal.throwIfAborted()
      using history = await this.ctx.sessionQuery.observeSession(id)
      if (history.header.cwd !== this.config.cwd || history.header.agentPreset !== undefined
        || history.header.origin !== undefined || history.header.parentSession !== undefined) {
        throw new Error('feishu-im: persisted Session does not belong to this driver composition')
      }
      const admitted = new Set<MessageId>()
      for (const event of history.events) {
        if (event.type === 'user/message') admitted.add(event.data.id)
        if (event.type === 'agent/inbox/spliced') {
          for (const inserted of event.data.inserted) admitted.add(inserted.id)
        }
        if (event.type === 'agent-preset/selected') throw new Error('feishu-im: preset Sessions require their original composition')
      }
      // Interrupted admissions remain canceled; a fresh human message may continue the saved history.
      agent.inbox.clear()
      while (!signal.aborted) {
        const message = worker.queue.shift()
        if (message === undefined) break
        const messageId = brandString<MessageId>(`lark:${message.messageId}`)
        if (admitted.has(messageId)) continue
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await this.cli.reply(message.messageId, 'started', messages[this.config.locale].started, signal)
          signal.throwIfAborted()
          const start = agent.session.seq
          timer = setTimeout(() => {
            agent.cancel({ kind: 'hook', reason: 'feishu-im taskTimeoutMs exceeded' })
          }, this.config.taskTimeoutMs)
          agent.followup(freezeMessage<UserMessage>({
            id: messageId, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: message.text }],
          }))
          admitted.add(messageId)
          await agent.whenIdle()
          clearTimeout(timer)
          await this.ctx.sessions.flush(agent.session)
          signal.throwIfAborted()
          using result = await this.ctx.sessionQuery.observeSession(id)
          const end = [...result.events].findLast(event => event.seq >= start && event.type === 'turn/end')
          if (end?.type === 'turn/end' && end.data.reason.kind === 'error') {
            process.stderr.write(`feishu-im: task ${message.messageId} ended with an error: ${errorChain(end.data.reason.error)}\n`)
          }
          await this.cli.reply(message.messageId, 'result', summarize(result.events, start, this.config.locale), signal)
        } catch (error: unknown) {
          if (!worker.controller.signal.aborted) {
            process.stderr.write(`feishu-im: task ${message.messageId} failed: ${errorChain(error)}` + '\n')
            this.notify(message, 'failure', messages[this.config.locale].taskFailed)
          }
        } finally {
          clearTimeout(timer)
        }
      }
    } finally {
      worker.closing = true
      await worker.handle?.dispose()
    }
  }

  /**
   * Stop admission, cancel owned Agents, and await all workers and replies.
   * @returns fulfillment only after owned work reaches quiescence.
   */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    for (const worker of this.workers.values()) {
      worker.closing = true
      worker.controller.abort()
      worker.handle?.agent.cancel({ kind: 'disposed' })
    }
    await Promise.allSettled([...this.workers.values()].map(worker => worker.done))
    await Promise.allSettled(this.replies)
  }
}
