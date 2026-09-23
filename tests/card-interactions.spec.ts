import { expect, it, vi } from 'vitest'
import { CardInteractions, decodeAnswers } from '../src/card-interactions.ts'
import type { Card, MessageTransport } from '../src/feishu-api.ts'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { parseMessage } from '../src/protocol.ts'
import { incoming } from './fixture.ts'

const source = parseMessage(JSON.stringify(incoming('one', 'task')))!
function harness() {
  const cards: Card[] = []
  const transport: MessageTransport = { reply: vi.fn(), updateCard: vi.fn().mockResolvedValue(undefined),
    card: vi.fn(async (_id, _phase, card) => { cards.push(card); return 'om_card' }) }
  const interactions = new CardInteractions(transport, 'cli_test', 'zh-CN', 1000)
  const callback = () => ({ appId: 'cli_test', senderId: source.senderId, chatId: source.chatId, messageId: 'om_card',
    value: { request: JSON.stringify(cards).match(/"request":"([a-f0-9]+)"/)![1], choice: 'allow' }, form: {} })
  return { interactions, transport, cards, callback }
}

it('accepts an exact one-shot approval and rejects spoofed or repeated callbacks', async () => {
  const h = harness()
  const result = h.interactions.approve(source, { toolName: 'bash', reason: 'Run requested command' } as ApprovalRequest, '{"command":"pwd"}')
  await vi.waitFor(() => expect(h.cards).toHaveLength(1))
  const callback = h.callback()
  for (const patch of [{ senderId: 'ou_foreign' }, { chatId: 'oc_other' }, { messageId: 'om_other' }, { appId: 'cli_other' },
    { value: { request: callback.value.request, choice: 'allow-always' } }]) expect(h.interactions.receive({ ...callback, ...patch })).toBe(false)
  expect(JSON.stringify(h.cards[0])).toContain('pwd')
  expect(h.interactions.receive(callback)).toBe(true)
  expect(h.interactions.receive(callback)).toBe(false)
  expect(await result).toBe('allowed-once')
  expect(h.transport.updateCard).toHaveBeenCalledOnce()
  await h.interactions.dispose()
})

it('fails closed on cancellation, expiry, delivery failure and restart', async () => {
  const h = harness(), abort = new AbortController()
  const result = h.interactions.approve(source, { toolName: 'bash', signal: abort.signal } as ApprovalRequest)
  await vi.waitFor(() => expect(h.cards).toHaveLength(1))
  const callback = h.callback(); abort.abort()
  expect(await result).toBe('cancelled')
  expect(h.interactions.receive(callback)).toBe(false)
  await h.interactions.dispose()
  const next = new CardInteractions(h.transport, 'cli_test', 'en', 20)
  expect(next.receive(callback)).toBe(false)
  expect(await next.approve(source, { toolName: 'bash' } as ApprovalRequest)).toBe('unavailable')
  vi.mocked(h.transport.card).mockRejectedValue(new Error('delivery failed'))
  expect(await next.approve(source, { toolName: 'bash' } as ApprovalRequest)).toBe('unavailable')
  await next.dispose()
})

it('preserves multi-select and custom answers while refusing unknown choices', async () => {
  const questions = [{ id: 'mode', question: 'Choose', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] },
    { id: 'name', question: 'Name' }]
  const h = harness()
  const result = h.interactions.question(source, { questions })
  await vi.waitFor(() => expect(h.cards).toHaveLength(1))
  expect(h.interactions.receive({ ...h.callback(), form: { q0: ['99'], custom1: 'Project' } })).toBe(false)
  expect(h.interactions.receive({ ...h.callback(), form: { q0: ['0', '1'], custom0: 'extra', custom1: 'Project' } })).toBe(true)
  expect(await result).toEqual({ answers: [{ id: 'mode', selected: ['A', 'B'], custom: 'extra' }, { id: 'name', selected: [], custom: 'Project' }] })
  await h.interactions.dispose()
})

it('validates single choice, free text and explicit plan-review verdicts', () => {
  const question = { id: 'one', question: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] }
  for (const form of [{}, { q0: ['0', '1'] }, { q0: 0 }, { q0: 'evil' }, { custom0: {} }, { custom0: 'x'.repeat(4001) }]) {
    expect(() => decodeAnswers([question], form)).toThrow()
  }
  const plan = { ...question, intent: { kind: 'plan-review' as const, approve: 'Yes' } }
  expect(() => decodeAnswers([plan], { custom0: 'maybe' })).toThrow()
  expect(decodeAnswers([plan], { q0: '1' })).toEqual({ answers: [{ id: 'one', selected: ['No'] }] })
})

it('awaits pending delivery during disposal and grants nothing', async () => {
  const h = harness(), sent = Promise.withResolvers<string>()
  vi.mocked(h.transport.card).mockImplementationOnce(() => sent.promise)
  const result = h.interactions.approve(source, { toolName: 'bash' } as ApprovalRequest)
  let done = false
  const closing = h.interactions.dispose().then(() => { done = true })
  await Promise.resolve(); expect(done).toBe(false)
  sent.resolve('om_card'); await closing
  expect(await result).toBe('cancelled')
})

it('refuses incomplete or oversized approvals and questions instead of presenting partial choices', async () => {
  const h = harness()
  expect(await h.interactions.approve(source, { toolName: 'bash', reason: 'x'.repeat(10001) } as ApprovalRequest)).toBe('unavailable')
  expect(await h.interactions.approve(source, { toolName: 'bash', callId: 'missing' } as ApprovalRequest)).toBe('unavailable')
  for (const questions of [Array.from({ length: 11 }, () => ({ id: 'q', question: 'Q' })), [{ id: 'q', question: 'Q', options: Array.from({ length: 51 }, () => ({ label: 'A' })) }], [{ id: 'q', question: '中'.repeat(14000) }]]) {
    await expect(h.interactions.question(source, { questions })).rejects.toThrow('feishu-im:')
  }
  expect(h.transport.card).not.toHaveBeenCalled(); await h.interactions.dispose()
})
it('shows option descriptions, supports plan rejection, and tolerates a failed card update', async () => {
  const h = harness()
  vi.mocked(h.transport.updateCard).mockRejectedValueOnce(new Error('offline'))
  const response = h.interactions.question(source, { questions: [{ id: 'plan', question: 'Continue?', header: 'Plan', detail: 'Do the proposed work', intent: { kind: 'plan-review', approve: 'Yes' }, options: [{ label: 'Yes', description: 'Proceed' }, { label: 'No' }] }] })
  await vi.waitFor(() => expect(h.cards).toHaveLength(1))
  expect(JSON.stringify(h.cards)).toContain('Proceed'); expect(JSON.stringify(h.cards)).not.toContain('custom0')
  h.interactions.receive({ ...h.callback(), form: { q0: '1' } }); await expect(response).resolves.toMatchObject({ answers: [{ selected: ['No'] }] })
  const decision = h.interactions.approve(source, { toolName: 'bash' } as ApprovalRequest)
  await vi.waitFor(() => expect(h.cards).toHaveLength(2))
  const token = JSON.stringify(h.cards[1]).match(/"request":"([a-f0-9]+)"/)![1]
  h.interactions.receive({ ...h.callback(), value: { request: token, choice: 'reject' } }); expect(await decision).toBe('rejected')
  expect(h.interactions.receive({ ...h.callback(), value: {} })).toBe(false)
  await h.interactions.dispose()
})

it('bounds concurrent decisions and cancels every pending request on shutdown', async () => {
  const h = harness()
  const pending = Array.from({ length: 16 }, () => h.interactions.approve(source, { toolName: 'bash' } as ApprovalRequest))
  expect(await h.interactions.approve(source, { toolName: 'bash' } as ApprovalRequest)).toBe('unavailable')
  expect(h.cards).toHaveLength(16)
  await h.interactions.dispose()
  expect(await Promise.all(pending)).toEqual(Array(16).fill('cancelled'))
  expect(h.interactions.receive(h.callback())).toBe(false)
})
