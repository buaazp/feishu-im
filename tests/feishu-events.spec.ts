import { describe, expect, it, vi } from 'vitest'
import { FeishuEvents, parseCardAction, parseFeishuMessage } from '../src/feishu-events.ts'
import { FeishuApi } from '../src/feishu-api.ts'
import { feishuFixture, nativeMessage } from './feishu-fixture.ts'

const event = { app_id: 'cli_0123456789abcdef', sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } },
  message: { message_id: 'om_one', chat_id: 'oc_one', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: '你好\n$(literal)' }) } }
describe('native Feishu events', () => {
  it('accepts only matching applications and private human text', () => {
    expect(parseFeishuMessage(event, 'cli_0123456789abcdef')?.text).toBe('你好\n$(literal)')
    expect(parseFeishuMessage(event, 'cli_other')).toBeUndefined()
    expect(parseFeishuMessage({ ...event, message: { ...event.message, chat_type: 'group' } }, 'cli_0123456789abcdef')).toBeUndefined()
    expect(parseFeishuMessage({ ...event, sender: { sender_type: 'bot' } }, 'cli_0123456789abcdef')).toBeUndefined()
    expect(() => parseFeishuMessage({ ...event, message: { ...event.message, content: 'bad' } }, 'cli_0123456789abcdef')).toThrow()
  })
  it('retains callback identity and form values for strict one-shot authorization', () => {
    const callback = { app_id: 'cli_0123456789abcdef', operator: { open_id: 'ou_owner' }, context: { open_chat_id: 'oc_one', open_message_id: 'om_card' },
      action: { value: { request: 'random-token' }, form_value: { answer: 'yes' } } }
    expect(parseCardAction(callback, 'cli_0123456789abcdef')).toMatchObject({ senderId: 'ou_owner', chatId: 'oc_one', messageId: 'om_card', form: { answer: 'yes' } })
    expect(parseCardAction(callback, 'cli_other')).toBeUndefined()
    expect(parseCardAction({ ...callback, operator: { open_id: 'all' } }, 'cli_0123456789abcdef')).toBeUndefined()
  })
})

it('receives real SDK frames, reconnects and closes without resurrecting its socket', async ({ onTestFinished }) => {
  const fixture = await feishuFixture()
  const api = new FeishuApi({ appId: 'cli_0123456789abcdef', appSecret: 'fake', apiOrigin: fixture.origin, requestTimeoutMs: 1000, maxReplyBytes: 1000 })
  const abort = new AbortController(), receive = vi.fn(), states: string[] = []
  const running = new FeishuEvents(api, 2000).consume(receive, () => false, state => states.push(state), abort.signal)
  onTestFinished(async () => { abort.abort(); await running; await api.close(); await fixture.close() })
  await vi.waitFor(() => expect(states).toContain('connected'))
  fixture.send(nativeMessage('one', 'hello'))
  await vi.waitFor(() => expect(receive).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' })))
  fixture.disconnect()
  await vi.waitFor(() => expect(states).toContain('reconnecting'))
  await vi.waitFor(() => expect(states.filter(state => state === 'connected')).toHaveLength(2))
  abort.abort(); await running
  await vi.waitFor(() => expect(fixture.sockets.size).toBe(0))
  expect(states.at(-1)).toBe('stopped')
})

it('cancels pending SDK discovery during shutdown', async ({ onTestFinished }) => {
  const fixture = await feishuFixture(); fixture.setReady(false)
  const api = new FeishuApi({ appId: 'cli_0123456789abcdef', appSecret: 'fake', apiOrigin: fixture.origin, requestTimeoutMs: 5000, maxReplyBytes: 1000 })
  const abort = new AbortController()
  const running = new FeishuEvents(api, 5000).consume(() => {}, () => false, () => {}, abort.signal)
  onTestFinished(async () => { abort.abort(); await running; await api.close(); await fixture.close() })
  await vi.waitFor(() => expect(fixture.calls).toHaveLength(1))
  abort.abort(); await running
  expect(fixture.sockets.size).toBe(0)
})
