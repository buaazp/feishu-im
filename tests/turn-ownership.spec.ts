import { afterEach, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { freezeMessage, type MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { createDriverHarness } from './driver-harness.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })

it('ignores a discarded Web inbox item while canceling the active Feishu turn', async () => {
  const h = await createDriverHarness(cleanup)
  h.send('first', 'hold'); await h.model.entered.promise
  const agent = h.ctx.agents.roots()[0]!
  agent.followup(freezeMessage<UserMessage>({ id: brandString<MessageId>('web:discarded'), role: 'user',
    source: { kind: 'user' }, content: [{ type: 'text', text: 'must not execute' }] }))
  h.send('stop', '/dsh stop'); await h.idle()
  expect(h.model.requests).toHaveLength(1)
  expect(agent.status).toBe('idle')
})

it('keeps a queued Web turn outside Feishu feedback and lets the next Feishu prompt wait for it', async () => {
  const h = await createDriverHarness(cleanup, { interactionTimeoutMs: 20 })
  const firstEntered = Promise.withResolvers<void>(), releaseFirst = Promise.withResolvers<void>()
  cleanup.push(async () => { releaseFirst.resolve() })
  const original = h.model.stream.bind(h.model)
  const approvalNext = vi.fn(async () => 'unavailable' as const)
  const questionNext = vi.fn(async () => ({ answers: [] }))
  let approval: unknown, questions: unknown
  vi.spyOn(h.model, 'stream').mockImplementation(async function* (options) {
    const users = options.messages.filter(message => message.role === 'user' && message.source?.kind === 'user')
    const text = users.at(-1)?.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (text === 'first') { firstEntered.resolve(); await releaseFirst.promise }
    if (text === 'from web') {
      const agent = h.ctx.agents.roots()[0]!
      approval = await h.ctx.waterfall(scopeTarget(agent, agent), 'approval/request',
        { agent, toolName: 'web-only' }, approvalNext)
      try {
        questions = await h.ctx.waterfall(scopeTarget(agent, agent), 'user-questions/request',
          { agent, questions: [{ id: 'web', question: 'Web-only question' }] }, questionNext)
      } catch { questions = 'claimed-by-feishu' }
    }
    yield* original(options)
  })

  h.send('first', 'first')
  await firstEntered.promise
  const agent = h.ctx.agents.roots()[0]!
  agent.followup(freezeMessage<UserMessage>({ id: brandString<MessageId>('web:queued'), role: 'user',
    source: { kind: 'user' }, content: [{ type: 'text', text: 'from web' }] }))
  h.send('second', 'second')
  releaseFirst.resolve()
  await h.idle()

  expect(h.model.requests.map(request => request.messages.filter(message => message.role === 'user'
    && message.source?.kind === 'user').at(-1)?.content[0])).toEqual([
    { type: 'text', text: 'first' },
    { type: 'text', text: 'from web' },
    { type: 'text', text: 'second' },
  ])
  const results = h.reply.mock.calls.filter(call => call[1] === 'result').map(call => call[2])
  expect(results).toEqual(['第 1 条消息：first', '第 3 条消息：second'])
  expect(approval).toBe('unavailable')
  expect(questions).toEqual({ answers: [] })
  expect(approvalNext).toHaveBeenCalledOnce()
  expect(questionNext).toHaveBeenCalledOnce()
  expect(vi.mocked(h.cli.card).mock.calls.filter(call => String(call[1]).startsWith('decision:'))).toEqual([])
})

it('settles a Feishu prompt discarded while it waits behind Web work', async () => {
  const h = await createDriverHarness(cleanup)
  h.send('first', 'first')
  await h.waitReply('result', '第 1 条消息：first')
  await h.idle()

  const started = Promise.withResolvers<void>(), releaseStarted = Promise.withResolvers<void>()
  cleanup.push(async () => { releaseStarted.resolve() })
  h.reply.mockImplementationOnce(async () => { started.resolve(); await releaseStarted.promise })
  h.send('second', 'must not run')
  await started.promise

  const agent = h.ctx.agents.roots()[0]!
  agent.followup(freezeMessage<UserMessage>({ id: brandString<MessageId>('web:hold'), role: 'user',
    source: { kind: 'user' }, content: [{ type: 'text', text: 'hold' }] }))
  await h.model.entered.promise
  releaseStarted.resolve()
  await vi.waitFor(() => expect(agent.inbox.nextTurn.map(message => message.id)).toContain('lark:om_second'))
  agent.cancel({ kind: 'user' })
  await h.idle()

  expect(h.reply.mock.calls.filter(call => call[0] === 'om_second' && call[1] === 'result').map(call => call[2]))
    .toEqual(['任务已停止。'])
  expect(h.model.requests).toHaveLength(2)
})
