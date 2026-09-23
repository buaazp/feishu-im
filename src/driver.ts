/** Private-chat workers owning serialized Agent intervals and durable message deduplication. */

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { brandString } from '@deepseek-ai/dsh-brand'
import { errorChain, freezeMessage, type MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type { Config } from './config.ts'
import { conversationId, parseMessage, type IncomingMessage } from './protocol.ts'
import type { MessageTransport } from './feishu-api.ts'
import type { CardAction } from './feishu-events.ts'
import { TaskFeedback, feedbackCopy } from './task-feedback.ts'
import { CardInteractions } from './card-interactions.ts'
import { messages, type Locale } from './messages.ts'

/** Shared public face of dsh-agent-presets and its later registry package. */
interface PresetRegistry {
  resolve(): Promise<{ id: string }>
  mount(ctx: Context, id: string): Promise<unknown>
}

// Both published preset packages record this same durable selection event.
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'agent-preset/selected': { agentPreset: string }
  }
}

interface Worker {
  controller: AbortController
  queue: IncomingMessage[]
  seen: Set<string>
  handle?: AgentHandle
  active?: { message: IncomingMessage; feedback: TaskFeedback; controller: AbortController }
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
export class FeishuDriver {
  private readonly workers = new Map<SessionId, Worker>()
  private readonly replies = new Set<Promise<void>>()
  private readonly lifetime = new AbortController()

  private readonly interactions: CardInteractions

  constructor(private readonly ctx: Context, private readonly config: Config, private readonly transport: MessageTransport) {
    this.interactions = new CardInteractions(transport, config.appId, config.locale, config.interactionTimeoutMs)
  }

  receiveAction(event: CardAction): boolean { return this.interactions.receive(event) }

  /**
   * Validate and schedule one native event without blocking event consumption.
   * @param input - normalized message from the authenticated SDK connection.
   */
  receive(input: IncomingMessage | string): void {
    if (this.lifetime.signal.aborted) return
    let message: IncomingMessage | undefined
    try {
      message = typeof input === 'string' ? parseMessage(input) : input
    } catch (error: unknown) {
      process.stderr.write(`feishu-im: rejected event: ${errorChain(error)}` + '\n')
      return
    }
    if (message === undefined || !this.config.allowedUsers.includes(message.senderId)) return
    const id = conversationId(this.config.legacyNamespace || this.config.appId, this.config.cwd, message)
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
    const task = this.transport.reply(message.messageId, phase, text, this.lifetime.signal)
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
      const presets = this.ctx.get('agentPresets') as PresetRegistry | undefined
      let presetId: string | undefined
      const admitted = new Set<MessageId>()
      if (stored !== undefined) {
        using history = await this.ctx.sessionQuery.observeSession(id)
        if (history.header.cwd !== this.config.cwd || history.header.origin !== undefined || history.header.parentSession !== undefined) {
          throw new Error('feishu-im: persisted Session does not belong to this driver composition')
        }
        presetId = history.header.agentPreset
        for (const event of history.events) {
          if (event.type === 'user/message') admitted.add(event.data.id)
          if (event.type === 'agent/inbox/spliced') for (const inserted of event.data.inserted) admitted.add(inserted.id)
          if (event.type === 'agent-preset/selected') presetId = event.data.agentPreset
        }
        if (presetId !== undefined && presets === undefined) throw new Error('feishu-im: original Agent preset is unavailable')
        if (presetId === undefined && presets !== undefined) throw new Error('feishu-im: legacy Session requires its original preset-free composition')
      } else if (presets !== undefined) presetId = (await presets.resolve()).id
      const selection = this.ctx.agentDefaultModel.currentSelection()
      const setup = async (agentCtx: Context, agent: AgentHandle['agent']): Promise<void> => {
        installModelSelection(agentCtx, { current: selection, assembled: undefined })
        if (presetId !== undefined) await presets!.mount(agentCtx, presetId)
        // The published Session event contract filters dispatch to this Agent's scope.
        agentCtx.on('session/event', (_session, event) => { worker.active?.feedback.observe(event) })
        agentCtx.on('approval/request', async (request, next) => {
          const active = worker.active
          if (request.agent !== agent || !active) return next()
          active.feedback.status(feedbackCopy[this.config.locale].waiting)
          return this.interactions.approve(active.message, { ...request,
            signal: AbortSignal.any([active.controller.signal, ...(request.signal ? [request.signal] : [])]),
          }, active.feedback.toolArguments(request.callId))
        }, { prepend: true })
        agentCtx.on('user-questions/request', async (request, next) => {
          const active = worker.active
          if (request.agent !== agent || !active) return next()
          active.feedback.status(feedbackCopy[this.config.locale].waiting)
          return this.interactions.question(active.message, { ...request,
            signal: AbortSignal.any([active.controller.signal, ...(request.signal ? [request.signal] : [])]),
          })
        }, { prepend: true })
      }
      const options = { agentOptions: { provider: selection.provider, model: selection.model }, setup, signal }
      worker.handle = stored === undefined
        ? await this.ctx.agents.create({ ...options, sessionId: id, meta: { cwd: this.config.cwd, ...(presetId ? { agentPreset: presetId } : {}) } })
        : await this.ctx.agents.resume({ ...options, resumeSessionId: id })
      const agent = worker.handle.agent
      signal.throwIfAborted()
      // Interrupted admissions remain canceled; a fresh human message may continue the saved history.
      agent.inbox.clear()
      while (!signal.aborted) {
        const message = worker.queue.shift()
        if (message === undefined) break
        const messageId = brandString<MessageId>(`lark:${message.messageId}`)
        if (admitted.has(messageId)) continue
        let timer: ReturnType<typeof setTimeout> | undefined
        const controller = new AbortController()
        const taskSignal = AbortSignal.any([signal, controller.signal])
        const feedback = new TaskFeedback(this.transport, message.messageId, this.config.locale, this.config.progressIntervalMs, taskSignal)
        worker.active = { message, feedback, controller }
        const cancel = () => controller.abort()
        signal.addEventListener('abort', cancel, { once: true })
        try {
          await this.transport.reply(message.messageId, 'started', messages[this.config.locale].started, signal)
          signal.throwIfAborted()
          const start = agent.session.seq
          timer = setTimeout(() => {
            controller.abort()
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
          const text = summarize(result.events, start, this.config.locale)
          await feedback.finish(text)
          await this.transport.reply(message.messageId, 'result', text, signal)
        } catch (error: unknown) {
          if (!worker.controller.signal.aborted) {
            process.stderr.write(`feishu-im: task ${message.messageId} failed: ${errorChain(error)}` + '\n')
            this.notify(message, 'failure', messages[this.config.locale].taskFailed)
          }
        } finally {
          clearTimeout(timer)
          controller.abort()
          signal.removeEventListener('abort', cancel)
          await feedback.dispose()
          worker.active = undefined
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
    await this.interactions.dispose()
    await Promise.allSettled([...this.workers.values()].map(worker => worker.done))
    await Promise.allSettled(this.replies)
  }
}
