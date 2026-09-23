/** Fault injection at the published SDK boundary, alongside real wire tests. */
import { beforeEach, expect, it, vi } from 'vitest'
import { FeishuEvents, parseCardAction, parseFeishuMessage } from '../src/feishu-events.ts'
import { FeishuApi } from '../src/feishu-api.ts'
const sdk = vi.hoisted(() => ({ options: {} as any, handlers: {} as Record<string, (value: unknown) => unknown>, start: vi.fn(async () => {}), close: vi.fn() }))
vi.mock('@larksuiteoapi/node-sdk', async original => ({
  ...await original<object>(),
  EventDispatcher: class { register(handlers: typeof sdk.handlers) { sdk.handlers = handlers; return this } },
  WSClient: class {
    constructor(options: any) { sdk.options = options; for (const level of ['debug', 'trace', 'info', 'warn', 'error']) options.logger[level]('SHOULD_NOT_LEAK') }
    start() { return sdk.start() }
    close() { sdk.close() }
  },
}))
beforeEach(() => { sdk.start.mockReset().mockResolvedValue(); sdk.close.mockReset() })
const appId = 'cli_0123456789abcdef'
const callback = { app_id: appId, operator: { open_id: 'ou_owner' }, context: { open_chat_id: 'oc_one', open_message_id: 'om_card' }, action: { value: { request: 'token' } } }
it('contains malformed/late ingress, acknowledges only accepted callbacks and suppresses SDK secrets', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  const api = new FeishuApi({ appId, appSecret: 'fake', apiOrigin: 'https://open.feishu.cn', maxReplyBytes: 100, requestTimeoutMs: 100 })
  const controller = new AbortController(), action = vi.fn(() => true), states: string[] = [], receive = vi.fn()
  const running = new FeishuEvents(api, 1000).consume(receive, action, value => states.push(value), controller.signal)
  sdk.options.onReady(); sdk.options.onReconnecting(); sdk.options.onReconnected()
  expect(sdk.handlers['card.action.trigger']!(callback)).toMatchObject({ toast: { type: 'success' } })
  expect(sdk.handlers['card.action.trigger']!({ ...callback, app_id: 'another' })).toMatchObject({ toast: { type: 'error' } })
  sdk.handlers['card.action.trigger']!(null); sdk.handlers['im.message.receive_v1']!({}); sdk.handlers['im.message.receive_v1']!({ app_id: appId })
  controller.abort(); sdk.handlers['im.message.receive_v1']!(null); sdk.handlers['card.action.trigger']!(callback)
  sdk.options.onReady(); sdk.options.onReconnecting(); sdk.options.onReconnected()
  await running; await api.close()
  expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'connected', 'stopped'])
  expect(stderr.mock.calls.flat().join('')).not.toContain('SHOULD_NOT_LEAK'); expect(action).toHaveBeenCalledOnce(); stderr.mockRestore()
})
it('rejects SDK endpoint changes and startup failures, closing the SDK on each failure', async () => {
  const api = new FeishuApi({ appId, appSecret: 'fake', apiOrigin: 'https://open.feishu.cn', maxReplyBytes: 100, requestTimeoutMs: 100 })
  vi.spyOn(api, 'json').mockResolvedValue({ code: 0 })
  const running = new FeishuEvents(api, 1000).consume(() => {}, () => false, () => {}, new AbortController().signal)
  const failure = expect(running).rejects.toThrow('connection failed')
  for (const url of ['https://attacker.test/callback/ws/endpoint', 'https://open.feishu.cn/wrong']) await expect(sdk.options.httpInstance.request({ url, data: {} })).rejects.toThrow('unexpected SDK endpoint')
  expect(await sdk.options.httpInstance.request({ url: 'https://open.feishu.cn/callback/ws/endpoint', data: {} })).toEqual({ code: 0 })
  sdk.options.onError(new Error('secret')); await failure; expect(sdk.close).toHaveBeenCalledOnce()
  sdk.start.mockRejectedValueOnce(new Error('SDK error'))
  await expect(new FeishuEvents(api, 1000).consume(() => {}, () => false, () => {}, new AbortController().signal)).rejects.toThrow('SDK connection failed')
  await api.close()
})
it('rejects every malformed message/callback identity and bounds text at the event boundary', () => {
  for (const context of [{ open_chat_id: 3 }, { open_chat_id: 'invalid' }, { open_chat_id: 'oc_one', open_message_id: null }, { open_chat_id: 'oc_one', open_message_id: 'invalid' }]) expect(parseCardAction({ ...callback, context }, appId)).toBeUndefined()
  expect(parseCardAction({ ...callback, operator: {} }, appId)).toBeUndefined()
  expect(parseCardAction(callback, appId)?.form).toEqual({})
  for (const content of [3, 'x'.repeat(65537)]) expect(() => parseFeishuMessage({ app_id: appId, sender: { sender_type: 'user', sender_id: {} }, message: { chat_type: 'p2p', message_type: 'text', content } }, appId)).toThrow('invalid message content')
})
