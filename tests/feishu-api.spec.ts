import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import { FeishuApi } from '../src/feishu-api.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const calls: Array<{ path: string; body: Record<string, unknown>; authorization?: string }> = []
  let handler = (path: string): object => path.includes('tenant_access_token')
    ? { code: 0, tenant_access_token: 'test-token', expire: 7200 }
    : { code: 0, data: { message_id: 'om_reply' } }
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    calls.push({ path: req.url!, body: body ? JSON.parse(body) : {}, authorization: req.headers.authorization })
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(handler(req.url!)))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(async () => { server.closeAllConnections(); server.close(); await once(server, 'close') })
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const api = new FeishuApi({ appId: 'cli_test', appSecret: 'fake-secret', apiOrigin: origin, requestTimeoutMs: 500, maxReplyBytes: 64 })
  cleanup.push(() => api.close())
  return { api, calls, setHandler(value: typeof handler) { handler = value } }
}

it('authenticates directly and sends bounded text with stable retry UUIDs', async () => {
  const { api, calls } = await fixture()
  const text = '中文🙂'.repeat(20)
  await api.reply('om_input', 'result', text, new AbortController().signal)
  const replies = calls.filter(call => call.path.endsWith('/reply'))
  expect(calls.filter(call => call.path.includes('tenant_access_token'))).toHaveLength(1)
  expect(replies.map(call => JSON.parse(String(call.body.content)).text).join('')).toBe(text)
  expect(replies.every(call => Buffer.byteLength(String(call.body.content)) <= 64)).toBe(true)
  expect(replies.every(call => call.authorization === 'Bearer test-token')).toBe(true)
  await api.reply('om_input', 'result', text, new AbortController().signal)
  expect(calls.filter(call => call.path.endsWith('/reply')).slice(replies.length).map(call => call.body.uuid))
    .toEqual(replies.map(call => call.body.uuid))
})

it('refreshes a rejected token once and preserves the message idempotency key', async () => {
  const { api, calls, setHandler } = await fixture()
  let count = 0
  setHandler(path => path.includes('tenant_access_token')
    ? { code: 0, tenant_access_token: `token-${++count}`, expire: 7200 }
    : count === 1 ? { code: 99991663 } : { code: 0, data: { message_id: 'om_reply' } })
  await api.reply('om_input', 'result', 'hello', new AbortController().signal)
  expect(count).toBe(2)
  const replies = calls.filter(call => call.path.endsWith('/reply'))
  expect(replies[0]!.body.uuid).toBe(replies[1]!.body.uuid)
})

it('creates and updates interactive cards and rejects API errors without leaking secrets', async () => {
  const { api, calls, setHandler } = await fixture()
  const signal = new AbortController().signal
  const card = { schema: '2.0', body: { elements: [] } }
  expect(await api.card('om_input', 'progress', card, signal)).toBe('om_reply')
  await api.updateCard('om_reply', card, signal)
  expect(calls.at(-1)!.path).toBe('/open-apis/im/v1/messages/om_reply')
  setHandler(() => ({ code: 999, msg: 'fake-secret' }))
  await expect(api.updateCard('om_reply', card, signal)).rejects.toThrow('999')
  await expect(api.updateCard('om_reply', card, signal)).rejects.not.toThrow('fake-secret')
})

it('does no network work after cancellation or close', async () => {
  const { api, calls } = await fixture()
  const controller = new AbortController(); controller.abort()
  await expect(api.reply('om_input', 'result', 'hello', controller.signal)).rejects.toThrow()
  await api.close()
  await expect(api.reply('om_input', 'result', 'hello', new AbortController().signal)).rejects.toThrow()
  expect(calls).toHaveLength(0)
})

it('rejects malformed and oversized HTTP responses and missing bot/message acknowledgements', async () => {
  const { readJson, record } = await import('../src/feishu-api.ts')
  for (const value of [null, [], 'x']) expect(() => record(value)).toThrow('invalid API response')
  await expect(readJson(new Response('failure', { status: 500 }))).rejects.toThrow('HTTP 500')
  await expect(readJson(new Response(null, { status: 500 }))).rejects.toThrow('HTTP 500')
  await expect(readJson(new Response(null))).rejects.toThrow('empty API response')
  await expect(readJson(new Response('123456789'), 4)).rejects.toThrow('size limit')
  await expect(readJson(new Response('invalid'))).rejects.toThrow()
  const { api, setHandler } = await fixture(), signal = new AbortController().signal
  setHandler(() => ({ code: 0, tenant_access_token: '', expire: 0 }))
  await expect(api.probe(signal)).rejects.toThrow('authentication failed')
  setHandler(path => path.includes('tenant_access_token') ? { code: 0, tenant_access_token: 'token', expire: 20 } : { code: 0, bot: { open_id: 'invalid' } })
  await expect(api.probe(signal)).rejects.toThrow('enable the application bot')
  setHandler(path => path.includes('tenant_access_token') ? { code: 0, tenant_access_token: 'token', expire: 7200 } : { code: 0, bot: { open_id: 'ou_bot' } })
  expect(await api.probe(signal)).toEqual({ openId: 'ou_bot', name: 'cli_test' })
  setHandler(() => ({ code: 0, data: {} })); await expect(api.card('om_source', 'phase', {}, signal)).rejects.toThrow('missing reply acknowledgement')
  setHandler(() => ({ code: 'secret' })); await expect(api.request('/test', {}, signal)).rejects.toThrow('invalid response')
})

it('shares token acquisition while a cancelled caller leaves another caller running', async () => {
  const { vi } = await import('vitest')
  const { api } = await fixture(), token = Promise.withResolvers<Record<string, unknown>>()
  const original = api.json.bind(api)
  vi.spyOn(api, 'json').mockImplementation((path, body, signal, method, accessToken) => path.includes('tenant_access_token') ? token.promise : original(path, body, signal, method, accessToken))
  const one = new AbortController()
  const first = api.card('om_one', 'phase', {}, one.signal), second = api.card('om_two', 'phase', {}, new AbortController().signal)
  const cancelled = expect(first).rejects.toThrow(); one.abort(); await cancelled
  token.resolve({ code: 0, tenant_access_token: 'shared', expire: 7200 })
  await expect(second).resolves.toBe('om_reply')
  await api.close()
})

it('preserves a refreshed token when a late concurrent request rejects the previous token', async () => {
  const { vi } = await import('vitest')
  const { api } = await fixture(), late = Promise.withResolvers<Record<string, unknown>>()
  let issued = 0, requests = 0
  const json = vi.spyOn(api, 'json').mockImplementation(async (path, _body, _signal, _method, token) => {
    if (path.includes('tenant_access_token')) return { code: 0, tenant_access_token: `token${++issued}`, expire: 7200 }
    requests++
    if (token === 'token1') return requests === 1 ? { code: 99991663 } : late.promise
    return { code: 0 }
  })
  const signal = new AbortController().signal
  const first = api.request('/first', {}, signal), second = api.request('/second', {}, signal)
  await first; late.resolve({ code: 99991663 }); await second
  expect(issued).toBe(2); expect(json.mock.calls.at(-1)?.[4]).toBe('token2')
})

it('joins active token acquisition during close and contains stream cancellation failure', async () => {
  const { vi } = await import('vitest')
  const { readJson } = await import('../src/feishu-api.ts')
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('too large')) }, cancel() { throw new Error('stream failure') } })
  await expect(readJson(new Response(body), 1)).rejects.toThrow('size limit')
  const { api } = await fixture(), token = Promise.withResolvers<Record<string, unknown>>()
  vi.spyOn(api, 'json').mockImplementation(() => token.promise)
  const pending = api.request('/pending', {}, new AbortController().signal)
  const rejected = expect(pending).rejects.toThrow()
  let closed = false
  const closing = api.close().then(() => { closed = true })
  await Promise.resolve(); expect(closed).toBe(false)
  token.reject(new Error('closed')); await closing; await rejected
})
