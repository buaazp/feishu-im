import { expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Card, MessageTransport } from '../src/feishu-api.ts'
import { TaskFeedback, textCard } from '../src/task-feedback.ts'

it('updates one bounded card with milestones and excludes reasoning and tool payloads', async () => {
  const cards: Card[] = []
  const transport: MessageTransport = { reply: vi.fn(), card: vi.fn(async (_id, _phase, card) => { cards.push(card); return 'om_progress' }),
    updateCard: vi.fn(async (_id, card) => { cards.push(card) }) }
  const feedback = new TaskFeedback(transport, 'om_one', 'zh-CN', 5, new AbortController().signal)
  feedback.observe({ type: 'step/start', data: {} } as unknown as SessionEvent)
  feedback.observe({ type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'PRIVATE_REASONING' }, { type: 'text', text: '先检查文件。' }] } } } as unknown as SessionEvent)
  feedback.observe({ type: 'tool/call', data: { callId: 'call1', name: 'read_file', arguments: '{"path":"one"}' } } as unknown as SessionEvent)
  await vi.waitFor(() => expect(cards).toHaveLength(1))
  feedback.observe({ type: 'tool/result', data: { message: { toolCallId: 'call1', content: [{ type: 'text', text: 'PRIVATE_TOOL_PAYLOAD' }] } } } as unknown as SessionEvent)
  await feedback.finish('完成')
  const text = JSON.stringify(cards)
  expect(text).toContain('先检查文件')
  expect(text).toContain('read_file')
  expect(text).toContain('工具已完成')
  expect(text).not.toContain('PRIVATE_')
  expect(transport.card).toHaveBeenCalledOnce()
  expect(feedback.toolArguments('call1')).toBe('{"path":"one"}')
  const count = cards.length; feedback.status('late'); await feedback.dispose()
  expect(cards).toHaveLength(count)
})

it('serializes slow updates, keeps final status last and drains cancellation', async () => {
  const sent = Promise.withResolvers<string>(), updates: Card[] = []
  const transport: MessageTransport = { reply: vi.fn(), card: () => sent.promise, updateCard: async (_id, card) => { updates.push(card) } }
  const feedback = new TaskFeedback(transport, 'om_one', 'en', 1, new AbortController().signal)
  feedback.status('working')
  await new Promise(resolve => setTimeout(resolve, 10))
  const finished = feedback.finish('FINAL'); sent.resolve('om_progress'); await finished
  expect(JSON.stringify(updates.at(-1))).toContain('FINAL')
  expect(JSON.stringify(updates.at(-1))).toContain('Task finished')
  await feedback.dispose()
})

it('coalesces slow sends, contains failed updates and stops scheduling after cancellation', async () => {
  const transport: MessageTransport = { reply: vi.fn(), card: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('om_progress'), updateCard: vi.fn().mockResolvedValue(undefined) }
  const controller = new AbortController(), feedback = new TaskFeedback(transport, 'om_source', 'en', 1, controller.signal)
  feedback.observe({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '' }] } } } as unknown as SessionEvent)
  for (let i = 0; i < 130; i++) feedback.observe({ type: 'tool/call', data: { callId: String(i), name: 'tool', arguments: '{}' } } as unknown as SessionEvent)
  await vi.waitFor(() => expect(transport.card).toHaveBeenCalledOnce())
  expect(feedback.toolArguments()).toBeUndefined(); expect(feedback.toolArguments('0')).toBeUndefined()
  feedback.observe({ type: 'tool/result', data: { message: { toolCallId: 'missing', isError: true } } } as unknown as SessionEvent)
  await vi.waitFor(() => expect(transport.card).toHaveBeenCalledTimes(2))
  controller.abort(); feedback.status('ignored'); await feedback.finish('cancelled'); await feedback.dispose()
  feedback.observe({ type: 'step/start' } as SessionEvent)
  expect(transport.updateCard).not.toHaveBeenCalled()
})

it('renders empty status content as a valid nonempty card', () => {
  expect(JSON.stringify(textCard('Title', ''))).toContain('…')
})
