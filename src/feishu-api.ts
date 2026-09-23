/** Direct bot OpenAPI. Credentials never enter messages, diagnostics or child processes. */
import { createHash } from 'node:crypto'
import { replyChunks } from './protocol.ts'

export interface FeishuApiOptions {
  appId: string
  appSecret: string
  apiOrigin: string
  requestTimeoutMs: number
  maxReplyBytes: number
}

export type Card = Record<string, unknown>
export interface MessageTransport {
  reply(messageId: string, phase: string, text: string, signal: AbortSignal): Promise<void>
  card(messageId: string, phase: string, card: Card, signal: AbortSignal): Promise<string>
  updateCard(messageId: string, card: Card, signal: AbortSignal): Promise<void>
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('feishu-im: invalid API response')
  return value as Record<string, unknown>
}

/** Bounds the whole response, including chunked bodies; cancels readers on all failures. */
export async function readJson(response: Response, maxBytes = 1_048_576): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`feishu-im: HTTP ${response.status}`)
  }
  if (!response.body) throw new Error('feishu-im: empty API response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.length
      if (bytes > maxBytes) throw new Error('feishu-im: API response exceeds size limit')
      chunks.push(item.value)
    }
    return record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** One application owns token state and every in-flight HTTP request. */
export class FeishuApi implements MessageTransport {
  private readonly lifetime = new AbortController()
  private readonly requests = new Set<Promise<unknown>>()
  private token?: { value: string; until: number }
  private tokenRequest?: Promise<string>

  constructor(readonly options: FeishuApiOptions) {}

  async json(path: string, body: unknown, signal: AbortSignal, method = 'POST', token?: string): Promise<Record<string, unknown>> {
    const combined = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.options.requestTimeoutMs)])
    combined.throwIfAborted()
    const work = (async () => readJson(await fetch(new URL(path, this.options.apiOrigin), {
      method, redirect: 'error', signal: combined,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })))()
    this.requests.add(work)
    try { return await work } finally { this.requests.delete(work) }
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted(); this.lifetime.signal.throwIfAborted()
    if (this.token && this.token.until > Date.now()) return this.token.value
    this.tokenRequest ??= (async () => {
      const data = await this.json('/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: this.options.appId, app_secret: this.options.appSecret,
      }, signal)
      if (data.code !== 0 || typeof data.tenant_access_token !== 'string' || !data.tenant_access_token
        || typeof data.expire !== 'number' || !Number.isFinite(data.expire) || data.expire <= 0) {
        throw new Error('feishu-im: application authentication failed; check App ID and App Secret')
      }
      this.token = { value: data.tenant_access_token, until: Date.now() + Math.max(0, data.expire - 60) * 1000 }
      return this.token.value
    })().finally(() => { this.tokenRequest = undefined })
    return this.tokenRequest
  }

  async request(path: string, body: unknown, signal: AbortSignal, method = 'POST'): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(signal)
      const response = await this.json(path, body, signal, method, token)
      if (response.code === 0) return response
      if (attempt === 0 && [99991663, 99991664, 99991665, 99991668].includes(Number(response.code))) {
        if (this.token?.value === token) this.token = undefined
        continue
      }
      // API messages and HTTP client errors can contain credentials. Only expose numeric codes.
      throw new Error(`feishu-im: Feishu API error ${typeof response.code === 'number' ? response.code : 'invalid response'}`)
    }
    throw new Error('feishu-im: token renewal failed')
  }

  async probe(signal: AbortSignal): Promise<{ name: string; openId: string }> {
    const response = await this.request('/open-apis/bot/v3/info', undefined, signal, 'GET')
    const bot = record(response.bot)
    if (typeof bot.open_id !== 'string' || !/^ou_[A-Za-z0-9]+$/.test(bot.open_id)) throw new Error('feishu-im: enable the application bot first')
    return { name: typeof bot.app_name === 'string' ? bot.app_name : this.options.appId, openId: bot.open_id }
  }

  private async send(messageId: string, phase: string, type: string, content: unknown, signal: AbortSignal): Promise<string> {
    const uuid = createHash('sha256').update(JSON.stringify([this.options.appId, messageId, phase])).digest('hex').slice(0, 32)
    const result = await this.request(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
      msg_type: type, content: JSON.stringify(content), uuid,
    }, signal)
    const id = record(result.data).message_id
    if (typeof id !== 'string' || !/^om_[A-Za-z0-9]+$/.test(id)) throw new Error('feishu-im: missing reply acknowledgement')
    return id
  }

  async reply(messageId: string, phase: string, text: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); this.lifetime.signal.throwIfAborted()
    for (const [index, chunk] of replyChunks(text, this.options.maxReplyBytes).entries()) {
      await this.send(messageId, `${phase}:${index}`, 'text', { text: chunk }, signal)
    }
  }

  card(messageId: string, phase: string, card: Card, signal: AbortSignal): Promise<string> {
    return this.send(messageId, phase, 'interactive', card, signal)
  }

  async updateCard(messageId: string, card: Card, signal: AbortSignal): Promise<void> {
    await this.request(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`, { content: JSON.stringify(card) }, signal, 'PATCH')
  }

  async close(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled(this.requests)
    this.token = undefined
  }
}
