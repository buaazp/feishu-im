/** Private-chat workers owning serialized Agent intervals and durable message deduplication. */

import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import { conversationStore } from './conversation-store.ts'
import { checkWorkspace } from './setup-manager.ts'
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
  cwd: string
  admitted: Set<MessageId>
  handle?: AgentHandle
  active?: { message: IncomingMessage; feedback: TaskFeedback; controller: AbortController; turn?: number
    claimed: (value: { start: SessionLogOffset } | undefined) => void
    settled: (value: SessionEvent<'turn/end'>) => void }
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
  private readonly retained = new Map<SessionId, Worker>()
  private state?: Promise<Domain<typeof conversationStore>>
  private domain?: Domain<typeof conversationStore>
  private readonly stopping = new Set<string>()
  private admission = Promise.resolve()
  private pendingAdmissions = 0
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
    const key = conversationId(this.config.legacyNamespace || this.config.appId, '', message)
    let stoppedEarly = false
    // One outstanding stop per chat bypasses a stalled admission backlog; record it in order afterward.
    if (message.text.trim() === '/dsh stop') {
      if (this.stopping.has(key)) return
      const route = this.domain?.table('chats').get(key)
      if (route?.sessionId && !route.admitted.includes(message.messageId)) {
        const id = brandString<SessionId>(route.sessionId)
        const worker = this.workers.get(id)
        const agent = this.retained.get(id)?.handle?.agent
        if (worker || agent?.status === 'running') {
          if (worker) this.stop(worker)
          else agent!.cancel({ kind: 'user' })
          this.stopping.add(key)
          stoppedEarly = true
          this.notify(message, 'stop', messages[this.config.locale].stopRequested)
        }
      }
    }
    if (!stoppedEarly && this.pendingAdmissions >= this.config.maxPendingMessages + this.config.maxConcurrentReplies) {
      this.notify(message, 'busy', messages[this.config.locale].busy)
      return
    }
    const admitted = message
    this.pendingAdmissions++
    this.admission = this.admission.then(async () => {
      if (this.stopping.has(key) && !stoppedEarly && !admitted.text.trim().startsWith('/dsh')) return
      if (!this.lifetime.signal.aborted) await this.admit(admitted, stoppedEarly)
    }).catch((error: unknown) => {
      if (!this.lifetime.signal.aborted) {
        process.stderr.write(`feishu-im: admission failed: ${errorChain(error)}\n`)
        this.notify(admitted, 'failure', messages[this.config.locale].startupFailed)
      }
    }).finally(() => {
      this.pendingAdmissions--
      if (stoppedEarly) this.stopping.delete(key)
    })
  }

  private async admit(message: IncomingMessage, stoppedEarly: boolean): Promise<void> {
    const domain = await (this.state ??= this.ctx.storageDomain.open(conversationStore).catch(error => {
      this.state = undefined
      throw error
    }))
    this.domain = domain
    this.lifetime.signal.throwIfAborted()
    const chats = domain.table('chats')
    const namespace = this.config.legacyNamespace || this.config.appId
    const key = conversationId(namespace, '', message)
    let route = chats.get(key)
    if (!route) {
      const sessionId = conversationId(namespace, this.config.cwd, message)
      const admitted = new Set<string>()
      if (await this.ctx.sessionPersistence.stat(sessionId)) {
        using history = await this.ctx.sessionQuery.observeSession(sessionId)
        for (const event of history.events) {
          const ids = event.type === 'user/message' ? [event.data.id]
            : event.type === 'agent/inbox/spliced' ? event.data.inserted.map(item => item.id) : []
          for (const id of ids) if (id.startsWith('lark:')) admitted.add(id.slice(5))
        }
      }
      this.lifetime.signal.throwIfAborted()
      route = { cwd: this.config.cwd, sessionId, admitted: [...admitted] }
      await chats.put(key, route)
    }
    if (route.pendingArchive) {
      await this.archive(brandString<SessionId>(route.pendingArchive))
      route = { ...route, pendingArchive: undefined }
      await chats.put(key, route)
    }
    if (route.admitted.includes(message.messageId)) return
    if (stoppedEarly) {
      await chats.put(key, { ...route, admitted: [...route.admitted, message.messageId] })
      return
    }
    if (route.sessionId && this.ctx.workspaceRegistry.archivedSessionIds.includes(brandString<SessionId>(route.sessionId))) {
      route = { ...route, sessionId: null }
    }
    const existing = route.sessionId ? this.workers.get(brandString<SessionId>(route.sessionId)) : undefined
    const current = route.sessionId ? this.retained.get(brandString<SessionId>(route.sessionId))?.handle?.agent : undefined
    const command = message.text.trim()
    const copy = messages[this.config.locale]
    if (command === '/dsh stop') {
      await chats.put(key, { ...route, admitted: [...route.admitted, message.messageId] })
      if (existing) this.stop(existing)
      else if (current?.status === 'running') current.cancel({ kind: 'user' })
      this.notify(message, 'stop', existing || current?.status === 'running' ? copy.stopRequested : copy.noTask)
      return
    }
    if (command === '/dsh status') {
      this.notify(message, 'status', `${existing ? `${existing.closing ? copy.stopping : copy.running} · ${copy.pending}: ${existing.queue.length}` : current?.status === 'running' ? copy.running : copy.idle}\n${copy.directory}: ${route.cwd}`)
      return
    }
    if (command === '/dsh archive') {
      const archiveId = route.sessionId
      if (existing) { this.stop(existing); await existing.done }
      const stored = archiveId && await this.ctx.sessionPersistence.stat(brandString<SessionId>(archiveId))
      route = { ...chats.get(key)!, sessionId: null }
      route = { ...route, pendingArchive: stored ? archiveId! : undefined, admitted: [...route.admitted, message.messageId] }
      await chats.put(key, route)
      if (!stored) { this.notify(message, 'archive', existing ? copy.stopped : copy.noTask); return }
      await this.archive(brandString<SessionId>(route.pendingArchive!))
      await chats.put(key, { ...route, pendingArchive: undefined })
      this.notify(message, 'archive', copy.archived)
      return
    }
    if (command === '/dsh new' || command.startsWith('/dsh cd ')) {
      if (existing || current?.status === 'running') { this.notify(message, 'busy', copy.stopBeforeSwitch); return }
      let cwd = route.cwd
      if (command.startsWith('/dsh cd ')) {
        const path = command.slice(8).trim()
        cwd = resolve(route.cwd, path === '~' ? homedir() : path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path)
        try {
          const document = this.ctx.get('settings')?.documentPath
          await checkWorkspace(cwd, document ? dirname(document) : undefined)
        }
        catch { this.notify(message, 'cd', copy.invalidDirectory); return }
      }
      await chats.put(key, { ...route, cwd, sessionId: conversationId(namespace, `${cwd}\0${message.messageId}`, message), admitted: [...route.admitted, message.messageId] })
      this.notify(message, command === '/dsh new' ? 'new' : 'cd', `${copy.newTask}\n${copy.directory}: ${cwd}`)
      return
    }
    if (command === '/dsh' || command.startsWith('/dsh ')) {
      this.notify(message, 'help', copy.help)
      return
    }
    const id = brandString<SessionId>(route.sessionId ?? conversationId(namespace, `${route.cwd}\0${message.messageId}`, message))
    if (existing) {
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
    if (route.sessionId !== id) await chats.put(key, { ...route, sessionId: id })
    const worker = this.retained.get(id) ?? {
      controller: new AbortController(), queue: [], seen: new Set<string>(), admitted: new Set<MessageId>(), cwd: route.cwd,
      closing: false, done: Promise.resolve(),
    }
    if (worker.handle?.agent.status === 'running') { this.notify(message, 'busy', copy.busy); return }
    worker.queue.push(message)
    worker.seen.add(message.messageId)
    this.workers.set(id, worker)
    worker.done = this.run(id, worker, key, chats).catch((error: unknown) => {
      if (!worker.controller.signal.aborted && !this.lifetime.signal.aborted) {
        process.stderr.write(`feishu-im: conversation ${id} failed: ${errorChain(error)}\n`)
        this.notify(message, 'failure', copy.startupFailed)
      }
    }).finally(() => {
      this.workers.delete(id)
      worker.controller = new AbortController()
      worker.closing = false
    })
  }

  private stop(worker: Worker): void {
    worker.closing = true
    worker.queue.length = 0
    worker.controller.abort()
    worker.handle?.agent.cancel({ kind: 'user' })
  }

  private async archive(id: SessionId): Promise<void> {
    const agent = this.retained.get(id)?.handle?.agent
    if (agent) { agent.cancel({ kind: 'user' }); await agent.whenIdle() }
    await this.ctx.workspaceRegistry.archiveSession(id)
    await this.retained.get(id)?.handle?.dispose()
    this.retained.delete(id)
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

  private async run(id: SessionId, worker: Worker, key: string, chats: KvTable<string, { cwd: string; sessionId: string | null; admitted: string[]; pendingArchive?: string }>): Promise<void> {
    const signal = AbortSignal.any([worker.controller.signal, this.lifetime.signal])
    try {
      if (!worker.handle) {
        if (this.ctx.agents.get(id) !== undefined) throw new Error('feishu-im: Session already has a live owner')
        const stored = await this.ctx.sessionPersistence.stat(id)
        signal.throwIfAborted()
        const presets = this.ctx.get('agentPresets') as PresetRegistry | undefined
        let presetId: string | undefined
        const admitted = worker.admitted
        if (stored !== undefined) {
          using history = await this.ctx.sessionQuery.observeSession(id)
          if (history.header.cwd !== worker.cwd || history.header.origin !== undefined || history.header.parentSession !== undefined) {
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
          // Scope and the claimed turn together keep retained Web work outside Feishu feedback and decisions.
          agentCtx.on('agent/inbox/claimed', ({ message, turn }) => {
            const active = worker.active
            if (!active || message.id !== `lark:${active.message.messageId}`) return
            active.turn = turn
            active.claimed({ start: agent.session.seq })
          })
          agentCtx.on('agent/inbox/discarded', ({ message }) => {
            const active = worker.active
            if (!active || message.id !== `lark:${active.message.messageId}` || active.turn !== undefined) return
            worker.active = undefined
            active.claimed(undefined)
          })
          agentCtx.on('session/event', (_session, event) => {
            const active = worker.active
            if (!active || active.turn === undefined) return
            if (event.type === 'turn/end' && event.data.turn === active.turn) {
              worker.active = undefined
              active.settled(event)
              return
            }
            if ((event.type === 'step/start' || event.type === 'assistant/message'
              || event.type === 'tool/call' || event.type === 'tool/result') && event.data.turn === active.turn) {
              active.feedback.observe(event)
            }
          })
          agentCtx.on('approval/request', async (request, next) => {
            const active = worker.active
            if (request.agent !== agent || active?.turn === undefined) return next()
            active.feedback.status(feedbackCopy[this.config.locale].waiting)
            return this.interactions.approve(active.message, { ...request,
              signal: AbortSignal.any([active.controller.signal, ...(request.signal ? [request.signal] : [])]),
            }, active.feedback.toolArguments(request.callId))
          }, { prepend: true })
          agentCtx.on('user-questions/request', async (request, next) => {
            const active = worker.active
            if (request.agent !== agent || active?.turn === undefined) return next()
            active.feedback.status(feedbackCopy[this.config.locale].waiting)
            return this.interactions.question(active.message, { ...request,
              signal: AbortSignal.any([active.controller.signal, ...(request.signal ? [request.signal] : [])]),
            })
          }, { prepend: true })
        }
        const options = { agentOptions: { provider: selection.provider, model: selection.model }, setup, signal }
        worker.handle = stored === undefined
          ? await this.ctx.agents.create({ ...options, sessionId: id, meta: { cwd: worker.cwd, ...(presetId ? { agentPreset: presetId } : {}) } })
          : await this.ctx.agents.resume({ ...options, resumeSessionId: id })
        // Only restart recovery discards interrupted inbox entries. Retained tasks may also be used in dsh.
        worker.handle.agent.inbox.clear()
        this.retained.set(id, worker)
      }
      const admitted = worker.admitted
      const agent = worker.handle.agent
      signal.throwIfAborted()
      while (!signal.aborted) {
        await agent.whenIdle()
        signal.throwIfAborted()
        const message = worker.queue.shift()
        if (message === undefined) break
        const messageId = brandString<MessageId>(`lark:${message.messageId}`)
        if (admitted.has(messageId)) continue
        let timer: ReturnType<typeof setTimeout> | undefined
        const controller = new AbortController()
        const taskSignal = AbortSignal.any([signal, controller.signal])
        const feedback = new TaskFeedback(this.transport, message.messageId, this.config.locale, this.config.progressIntervalMs, taskSignal)
        const claimed = Promise.withResolvers<{ start: SessionLogOffset } | undefined>()
        const settled = Promise.withResolvers<SessionEvent<'turn/end'>>()
        worker.active = { message, feedback, controller, claimed: claimed.resolve, settled: settled.resolve }
        const cancel = () => controller.abort()
        signal.addEventListener('abort', cancel, { once: true })
        try {
          await this.transport.reply(message.messageId, 'started', messages[this.config.locale].started, signal)
          signal.throwIfAborted()
          // Persist admission before side effects, including across task/directory switches.
          await chats.update(key, current => ({ ...current, admitted: [...current.admitted, message.messageId] }))
          taskSignal.throwIfAborted()
          agent.followup(freezeMessage<UserMessage>({
            id: messageId, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: message.text }],
          }))
          admitted.add(messageId)
          const claim = await claimed.promise
          if (!claim) {
            signal.throwIfAborted()
            const text = messages[this.config.locale].stopped
            await feedback.finish(text)
            await this.transport.reply(message.messageId, 'result', text, signal)
            continue
          }
          timer = setTimeout(() => {
            controller.abort()
            agent.cancel({ kind: 'hook', reason: 'feishu-im taskTimeoutMs exceeded' })
          }, this.config.taskTimeoutMs)
          const end = await settled.promise
          clearTimeout(timer)
          await this.ctx.sessions.flush(agent.session)
          signal.throwIfAborted()
          using result = await this.ctx.sessionQuery.observeSession(id)
          if (end.data.reason.kind === 'error') {
            process.stderr.write(`feishu-im: task ${message.messageId} ended with an error: ${errorChain(end.data.reason.error)}\n`)
          }
          const own = [...result.events].filter(event => event.seq >= claim.start && event.seq <= end.seq)
          const text = summarize(own, claim.start, this.config.locale)
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
      // Idle handles remain published in dsh until explicit archive or shutdown.
    }
  }

  /**
   * Await admitted work and replies without releasing persistent task handles.
   */
  async whenIdle(): Promise<void> {
    await this.admission
    await Promise.allSettled([...this.workers.values()].map(worker => worker.done))
    await Promise.allSettled(this.replies)
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
    await this.admission
    await this.interactions.dispose()
    await Promise.allSettled([...this.workers.values()].map(worker => worker.done))
    await Promise.allSettled([...this.retained.values()].map(worker => worker.handle!.dispose()))
    this.retained.clear()
    await Promise.allSettled(this.replies)
    await this.state?.then(domain => domain.close()).catch((error: unknown) => {
      process.stderr.write(`feishu-im: state close failed: ${errorChain(error)}\n`)
    })
  }
}
