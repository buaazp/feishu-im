import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationId, parseMessage } from '../src/protocol.ts'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import { summarize } from '../src/driver.ts'
import { incoming } from './fixture.ts'
import { createDriverHarness } from './driver-harness.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

const harness = (patch: Parameters<typeof createDriverHarness>[1] = {}) => createDriverHarness(cleanup, patch)

describe('private-chat Agent ownership', () => {
  it('localizes control replies while preserving the model answer', async () => {
    const h = await harness({ locale: 'en' })
    h.send('help', '/dsh help')
    await h.waitReply('help', 'Send text')
    h.send('1', 'first')
    await h.waitReply('started', 'Working on your task.')
    await h.waitReply('result', '第 1 条消息：first')
    await h.idle()
  })

  it('continues saved history and suppresses duplicate durable admissions after worker disposal', async () => {
    const h = await harness()
    h.send('1', 'first')
    await h.waitReply('result', '第 1 条消息：first')
    await h.idle()
    h.send('2', 'second')
    await h.waitReply('result', '第 2 条消息：second')
    await h.idle()
    h.send('1', 'first')
    h.send('3', 'third')
    await h.waitReply('result', '第 3 条消息：third')
    await h.idle()
    expect(h.model.requests).toHaveLength(3)
    const id = conversationId(h.config.appId, h.config.cwd, parseMessage(JSON.stringify(incoming('1', 'first')))!)
    using history = await h.ctx.sessionQuery.observeSession(id)
    expect([...history.events].filter(event => event.type === 'user/message')).toHaveLength(3)
  })

  it('rejects unauthorized messages and controls a running task without admitting queued work', async () => {
    const h = await harness({ maxPendingMessages: 1, maxConversations: 1 })
    h.send('foreign', 'not allowed', 'ou_foreign')
    h.driver.receive('invalid json')
    h.send('1', 'hold')
    await h.model.entered.promise
    h.send('2', 'queued')
    h.send('2', 'queued')
    h.send('3', 'over capacity')
    h.send('4', '/dsh status')
    await h.waitReply('status', '等待消息: 1')
    await h.waitReply('busy', '暂时无法接收')
    h.send('5', '/dsh stop')
    await h.waitReply('stop', '清空等待队列')
    await h.idle()
    expect(h.model.requests).toHaveLength(1)
    h.send('6', '/dsh stop')
    h.send('7', '/dsh help')
    h.send('8', '/dsh status')
    await h.waitReply('stop', '没有运行')
    await h.waitReply('help', '/dsh status')
    await h.waitReply('status', '空闲')
  })

  it('logs a failed model turn even when Agent idle resolves normally', async () => {
    const h = await harness()
    vi.spyOn(h.model, 'stream').mockImplementation(() => { throw new Error('model endpoint unavailable') })
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      h.send('failed', 'first')
      await h.waitReply('result', '任务未完成')
      await h.idle()
      expect(stderr.mock.calls.flat().join('')).toContain('model endpoint unavailable')
      expect(stderr.mock.calls.flat().join('')).toContain('task om_failed ended with an error')
    } finally { stderr.mockRestore() }
  })

  it('cancels and drains Agents during disposal and ignores subsequent ingress', async () => {
    const h = await harness()
    h.send('1', 'hold')
    await h.model.entered.promise
    await h.driver.dispose()
    expect(h.ctx.agents.roots()).toHaveLength(0)
    const count = h.reply.mock.calls.length
    h.send('2', 'late')
    expect(h.reply).toHaveBeenCalledTimes(count)
  })

  it('cancels tasks at their configured deadline', async () => {
    const h = await harness({ taskTimeoutMs: 100 })
    h.send('1', 'hold')
    await h.waitReply('result', '任务已停止')
    await h.idle()
  })

  it('does not rerun task side effects after a failed result reply', async () => {
    const h = await harness()
    h.reply.mockImplementation(async (_id, phase) => { if (phase === 'result') throw new Error('network unavailable') })
    h.send('1', 'first')
    await h.waitReply('failure', '不会自动重试')
    await h.idle()
    h.reply.mockResolvedValue()
    h.send('1', 'first')
    h.send('2', 'second')
    await h.waitReply('result', '第 2 条消息：second')
    expect(h.model.requests).toHaveLength(2)
  })

  it('limits concurrent conversations and reports stopping state', async () => {
    const h = await harness({ allowedUsers: ['ou_owner', 'ou_second'], maxConversations: 1 })
    h.send('1', 'hold')
    await h.model.entered.promise
    h.send('2', 'another conversation', 'ou_second')
    await h.waitReply('busy', '会话已达上限')
    h.send('3', '/dsh stop')
    h.send('4', '/dsh status')
    h.send('5', 'late')
    await h.waitReply('status', '正在停止')
    await h.waitReply('busy', '暂时无法接收')
    await h.idle()
  })

  it('bounds control replies, observes failures, and drains cancellation', async () => {
    const h = await harness({ maxConcurrentReplies: 1 })
    const pending = Promise.withResolvers<undefined>()
    h.reply.mockImplementationOnce(() => pending.promise)
    h.send('1', '/dsh help')
    h.send('2', '/dsh status')
    expect(h.reply).toHaveBeenCalledTimes(1)
    pending.reject(new Error('network unavailable'))
    await vi.waitFor(() => { expect(h.reply.mock.settledResults[0]?.type).toBe('rejected') })
    const stopped = Promise.withResolvers<undefined>()
    h.reply.mockImplementationOnce(() => stopped.promise)
    h.send('3', '/dsh help')
    const disposed = h.driver.dispose()
    stopped.reject(new Error('aborted'))
    await disposed
  })

  it('refuses another live owner without disposing that owner', async () => {
    const h = await harness()
    const id = conversationId(h.config.appId, h.config.cwd, parseMessage(JSON.stringify(incoming('1', 'first')))!)
    const owner = await h.ctx.agents.create({ sessionId: id, meta: { cwd: h.config.cwd } })
    cleanup.push(() => owner.dispose())
    h.send('1', 'first')
    await h.waitReply('failure', '启动失败')
    expect(h.ctx.agents.get(id)).toBeDefined()
    expect(h.model.requests).toHaveLength(0)
  })

  it('cancels admission during persistence lookup without sending an error reply', async () => {
    const h = await harness()
    const lookup = Promise.withResolvers<undefined>()
    vi.spyOn(h.ctx.sessionPersistence, 'stat').mockImplementation(() => lookup.promise)
    h.send('1', 'first')
    const disposed = h.driver.dispose()
    lookup.resolve(undefined)
    await disposed
    expect(h.reply).not.toHaveBeenCalled()
    expect(h.ctx.agents.roots()).toHaveLength(0)
  })

  it('rejects stored history from a different workspace', async () => {
    const h = await harness()
    const id = conversationId(h.config.appId, h.config.cwd, parseMessage(JSON.stringify(incoming('1', 'first')))!)
    const owner = await h.ctx.agents.create({ sessionId: id, meta: { cwd: '/other-workspace' } })
    await h.ctx.sessions.flush(owner.agent.session)
    await owner.dispose()
    h.send('1', 'first')
    await h.waitReply('failure', '启动失败')
    await h.idle()
    expect(h.model.requests).toHaveLength(0)
  })

  it('returns only committed assistant text for a completed interval', async () => {
    const h = await harness()
    h.send('1', 'first')
    await h.waitReply('result', '第 1 条消息')
    await h.idle()
    const id = conversationId(h.config.appId, h.config.cwd, parseMessage(JSON.stringify(incoming('1', 'first')))!)
    using history = await h.ctx.sessionQuery.observeSession(id)
    const events = [...history.events]
    const start = SessionLogOffset(0)
    expect(summarize([], start, 'zh-CN')).toContain('任务未完成')
    expect(summarize(events.map(event => event.type === 'assistant/message'
      ? { ...event, data: { ...event.data, message: { ...event.data.message, content: [] } } } : event), start, 'zh-CN')).toContain('没有文本回复')
    expect(summarize(events, SessionLogOffset(events.at(-1)!.seq), 'zh-CN')).toContain('没有文本回复')
  })

  it('refuses history whose tools were selected by another preset composition', async () => {
    const h = await harness()
    const id = conversationId(h.config.appId, h.config.cwd, parseMessage(JSON.stringify(incoming('1', 'first')))!)
    const owner = await h.ctx.agents.create({ sessionId: id, meta: { cwd: h.config.cwd } })
    owner.agent.session.append('agent-preset/selected', { agentPreset: 'other' })
    await h.ctx.sessions.flush(owner.agent.session)
    await owner.dispose()
    h.send('1', 'first')
    await h.waitReply('failure', '启动失败')
    await h.idle()
    expect(h.model.requests).toHaveLength(0)
  })
})

it('answers real scoped approval and question services with one-shot cards and respects never policy', async () => {
  const { default: ApprovalService, setApprovalPolicy } = await import('@deepseek-ai/dsh-user-approval')
  const { default: UserQuestions } = await import('@deepseek-ai/dsh-user-questions')
  const h = await harness()
  await h.ctx.plugin(ApprovalService, { policy: 'ask' }); await h.ctx.plugin(UserQuestions)
  const cards: Array<{ id: string; card: Record<string, unknown> }> = []
  vi.mocked(h.cli.card).mockImplementation(async (_source, _phase, card) => { const id = `om_card${cards.length}`; cards.push({ id, card }); return id })
  h.send('decision', 'hold'); await h.model.entered.promise
  const agent = h.ctx.agents.roots()[0]!
  const approval = h.ctx.approval.request({ agent, toolName: 'test_action', reason: 'Create a test file', signal: new AbortController().signal })
  await vi.waitFor(() => expect(cards.some(item => JSON.stringify(item.card).includes('choice'))).toBe(true))
  const decision = cards.find(item => JSON.stringify(item.card).includes('choice'))!
  const token = /"request":"([a-f0-9]+)"/.exec(JSON.stringify(decision.card))![1]!
  const callback = { appId: h.config.appId, senderId: 'ou_owner', chatId: 'oc_private', messageId: decision.id, value: { request: token, choice: 'allow' }, form: {} }
  expect(h.driver.receiveAction(callback)).toBe(true); expect(h.driver.receiveAction(callback)).toBe(false)
  await expect(approval).resolves.toBe('allowed-once')
  const question = h.ctx.userQuestions.ask({ agent, signal: new AbortController().signal, questions: [{ id: 'color', question: 'Choose a color', options: [{ label: 'Blue' }, { label: 'Green' }] }] })
  await vi.waitFor(() => expect(cards.some(item => JSON.stringify(item.card).includes('Choose a color'))).toBe(true))
  const card = cards.find(item => JSON.stringify(item.card).includes('Choose a color'))!
  const request = /"request":"([a-f0-9]+)"/.exec(JSON.stringify(card.card))![1]!
  expect(h.driver.receiveAction({ ...callback, messageId: card.id, value: { request }, form: { q0: '1' } })).toBe(true)
  await expect(question).resolves.toEqual({ answers: [{ id: 'color', selected: ['Green'] }] })
  setApprovalPolicy(agent.session, 'never')
  await expect(h.ctx.approval.request({ agent, toolName: 'test_action' })).resolves.toBe('rejected')
  const { scopeTarget } = await import('@deepseek-ai/dsh-scope')
  const noSignal = h.ctx.waterfall(scopeTarget(agent, agent), 'approval/request', { agent, toolName: 'test_action' }, async () => 'unavailable' as const)
  const pending = h.ctx.userQuestions.ask({ agent, questions: [{ id: 'later', question: 'Unanswered' }] })
  const cancelled = expect(pending).rejects.toThrow()
  await h.driver.dispose(); await cancelled; expect(await noSignal).toBe('cancelled')
})

it('preserves the chosen preset on resume and refuses to retrofit a preset onto legacy history', async () => {
  const h = await harness()
  const preset = { id: 'original' }
  const registry = { resolve: vi.fn(async () => preset), mount: vi.fn(async () => preset) }
  h.ctx.provide('agentPresets', registry as unknown as import('@deepseek-ai/dsh-agent-preset-registry').AgentPresetRegistry)
  h.send('presetone', 'first'); await h.waitReply('result', '第 1 条消息'); await h.idle()
  h.send('presettwo', 'second'); await h.waitReply('result', '第 2 条消息'); await h.idle()
  expect(registry.resolve).toHaveBeenCalledOnce()
  expect(registry.mount.mock.calls).toHaveLength(2)
  expect(registry.mount.mock.calls).toEqual([expect.arrayContaining(['original']), expect.arrayContaining(['original'])])
  const legacy = await harness()
  legacy.send('legacyone', 'first'); await legacy.waitReply('result', '第 1 条消息'); await legacy.idle()
  legacy.ctx.provide('agentPresets', registry as unknown as import('@deepseek-ai/dsh-agent-preset-registry').AgentPresetRegistry)
  legacy.send('legacytwo', 'second'); await legacy.waitReply('failure', '启动失败'); await legacy.idle()
  expect(legacy.model.requests).toHaveLength(1)
})

it('delegates idle and foreign approval/question requests instead of claiming them', async () => {
  const { scopeTarget } = await import('@deepseek-ai/dsh-scope')
  const h = await harness()
  const create = h.ctx.agents.create.bind(h.ctx.agents)
  const check = async (target: import('@deepseek-ai/dsh-agent').Agent, foreign = target) => {
    const next = vi.fn(async () => 'unavailable' as const), questions = vi.fn(async () => ({ answers: [] }))
    expect(await h.ctx.waterfall(scopeTarget(target, target), 'approval/request', { agent: foreign, toolName: 'unowned' }, next)).toBe('unavailable')
    expect(await h.ctx.waterfall(scopeTarget(target, target), 'user-questions/request', { agent: foreign, questions: [] }, questions)).toEqual({ answers: [] })
    expect(next).toHaveBeenCalledOnce(); expect(questions).toHaveBeenCalledOnce()
  }
  const wrapped = vi.spyOn(h.ctx.agents, 'create').mockImplementation(async options => {
    const handle = await create(options)
    await check(handle.agent)
    return handle
  })
  h.send('delegation', 'hold'); await h.model.entered.promise
  wrapped.mockRestore()
  const foreign = await h.ctx.agents.create({ sessionId: conversationId('foreign', h.config.cwd, parseMessage(JSON.stringify(incoming('foreign', 'task')))! ), meta: { cwd: h.config.cwd } }); cleanup.push(() => foreign.dispose())
  const owner = h.ctx.agents.roots().find(agent => agent !== foreign.agent)!
  await check(owner, foreign.agent)
  // Actual foreign events are excluded by the published Agent-scoped dispatch contract.
  foreign.agent.session.append('agent-preset/selected', { agentPreset: 'foreign' })
  expect(h.cli.card).not.toHaveBeenCalled()
})
