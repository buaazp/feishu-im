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
