import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import { FeishuApi, replyChunks } from '../src/feishu-api.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture(maxReplyBytes = 64) {
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
  const api = new FeishuApi({ appId: 'cli_test', appSecret: 'fake-secret', apiOrigin: origin, requestTimeoutMs: 500, maxReplyBytes })
  cleanup.push(() => api.close())
  return { api, calls, setHandler(value: typeof handler) { handler = value } }
}

function replyMarkdown(body: Record<string, unknown>): string {
  expect(body.msg_type).toBe('post')
  const post = JSON.parse(String(body.content)) as { zh_cn: { content: Array<Array<{ tag: string; text: string }>> } }
  for (const paragraph of post.zh_cn.content) {
    expect(paragraph).toHaveLength(1)
    expect(paragraph[0]!.tag).toBe('md')
  }
  return post.zh_cn.content.map(paragraph => paragraph[0]!.text).join('\n')
}

it('authenticates directly and sends bounded Markdown posts with stable retry UUIDs', async () => {
  const { api, calls } = await fixture()
  const text = '中文🙂'.repeat(20)
  await api.reply('om_input', 'result', text, new AbortController().signal)
  const replies = calls.filter(call => call.path.endsWith('/reply'))
  expect(calls.filter(call => call.path.includes('tenant_access_token'))).toHaveLength(1)
  expect(replies.map(call => replyMarkdown(call.body)).join('')).toBe(text)
  expect(replies.every(call => Buffer.byteLength(String(call.body.content)) <= 64)).toBe(true)
  expect(replies.every(call => call.authorization === 'Bearer test-token')).toBe(true)
  await api.reply('om_input', 'result', text, new AbortController().signal)
  expect(calls.filter(call => call.path.endsWith('/reply')).slice(replies.length).map(call => call.body.uuid))
    .toEqual(replies.map(call => call.body.uuid))
})

it('sends headings, links, tables and fenced code through Feishu post Markdown content', async () => {
  const { api, calls } = await fixture(4096)
  const markdown = [
    '## 执行结果', '', '**完成**，请查看 [文档](https://example.test/docs)。', '',
    '| 文件 | 状态 |', '| --- | --- |', '| app.ts | 已修复 |', '',
    '```typescript', 'console.log("中文🙂")', '```', '', '- [x] 检查通过',
  ].join('\n')
  await api.reply('om_input', 'result', markdown, new AbortController().signal)
  const replies = calls.filter(call => call.path.endsWith('/reply'))
  expect(replies).toHaveLength(1)
  expect(replyMarkdown(replies[0]!.body)).toBe(markdown)
})

it('keeps each split code block renderable and preserves every source line and reply UUID', async () => {
  const { api, calls } = await fixture(240)
  const code = Array.from({ length: 15 }, (_, index) => `const item${index} = "中文🙂-${index}";`)
  const markdown = ['## 代码', '', '```typescript', ...code, '```', '', '**完成**'].join('\n')
  const signal = new AbortController().signal
  await api.reply('om_input', 'result', markdown, signal)
  const replies = calls.filter(call => call.path.endsWith('/reply'))
  expect(replies.length).toBeGreaterThan(1)
  expect(new Set(replies.map(call => call.body.uuid)).size).toBe(replies.length)
  const receivedCode: string[] = []
  for (const { body } of replies) {
    expect(Buffer.byteLength(String(body.content))).toBeLessThanOrEqual(240)
    let inCode = false
    for (const line of replyMarkdown(body).split('\n')) {
      if (line === '```typescript') { expect(inCode).toBe(false); inCode = true }
      else if (line === '```') { expect(inCode).toBe(true); inCode = false }
      else if (line.startsWith('const item')) { expect(inCode).toBe(true); receivedCode.push(line) }
    }
    expect(inCode).toBe(false)
  }
  expect(receivedCode).toEqual(code)
  await api.reply('om_input', 'result', markdown, signal)
  expect(calls.filter(call => call.path.endsWith('/reply')).slice(replies.length).map(call => call.body))
    .toEqual(replies.map(call => call.body))
})

it('bounds an oversized single code line including post JSON escapes without losing Unicode', async () => {
  const { api, calls } = await fixture(240)
  const code = '中文🙂\\"'.repeat(80)
  await api.reply('om_input', 'result', `\`\`\`text\n${code}\n\`\`\``, new AbortController().signal)
  const replies = calls.filter(call => call.path.endsWith('/reply'))
  expect(replies.length).toBeGreaterThan(1)
  const fragments = replies.map(({ body }) => {
    expect(Buffer.byteLength(String(body.content))).toBeLessThanOrEqual(240)
    const markdown = replyMarkdown(body)
    expect(markdown).toMatch(/^```text\n[\s\S]*\n```$/)
    return markdown.slice('```text\n'.length, -'\n```'.length)
  })
  expect(fragments.join('')).toBe(code)
})

it.each([
  ['~~~typescript\nconst value = `literal`;\n~~~', '~~~typescript\nconst value = `literal`;\n~~~'],
  ['````typescript\n```\n~~~\n```` extra\n````', '````typescript\n```\n~~~\n```` extra\n````'],
  ['```type`script\nplain text', '```type`script\nplain text'],
  ['~~~type`script\ncode', '~~~type`script\ncode\n~~~'],
  ['```typescript\r\ncode\r\n```', '```typescript\r\ncode\r\n```'],
])('respects Markdown fence markers and closes unfinished code: %s', (markdown, expected) => {
  expect(replyChunks(markdown, 4096)).toEqual([expected])
})

it('rejects an unrepresentable code fence before sending any partial answer', async () => {
  const { api, calls } = await fixture(64)
  const markdown = 'First paragraph.\n'.repeat(20) + '```typescript\nconst result = 1;\n```'
  await expect(api.reply('om_input', 'result', markdown, new AbortController().signal)).rejects.toThrow('Markdown fence')
  expect(calls).toHaveLength(0)
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
  setHandler(() => ({ code: 0, bot: { open_id: 'ou_bot', app_name: 'Test bot' } }))
  expect(await api.probe(signal)).toEqual({ openId: 'ou_bot', name: 'Test bot' })
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
