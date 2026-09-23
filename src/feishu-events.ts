/** SDK WebSocket lifecycle and validation at the Feishu event boundary. */
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import type { Duplex } from 'node:stream'
import { EventDispatcher, WSClient, defaultHttpInstance, type HttpInstance, type HttpRequestOptions, type Logger } from '@larksuiteoapi/node-sdk'
import { FeishuApi, record } from './feishu-api.ts'
import { parseMessage, type IncomingMessage } from './protocol.ts'

// SDK debug/error objects may contain application credentials and socket tickets.
const logger: Logger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} }

export function parseFeishuMessage(value: unknown, appId: string): IncomingMessage | undefined {
  const event = record(value)
  if (event.app_id !== appId) return undefined
  const sender = record(event.sender)
  const message = record(event.message)
  if (sender.sender_type !== 'user' || message.chat_type !== 'p2p' || message.message_type !== 'text') return undefined
  const identity = record(sender.sender_id)
  if (typeof message.content !== 'string' || Buffer.byteLength(message.content) > 65_536) throw new Error('feishu-im: invalid message content')
  const content = record(JSON.parse(message.content))
  return parseMessage(JSON.stringify({ type: 'im.message.receive_v1', sender_type: 'user', chat_type: 'p2p', message_type: 'text',
    message_id: message.message_id, chat_id: message.chat_id, sender_id: identity.open_id, content: content.text }))
}

export interface CardAction {
  appId: string
  senderId: string
  chatId: string
  messageId: string
  value: Record<string, unknown>
  form: Record<string, unknown>
}

export function parseCardAction(value: unknown, appId: string): CardAction | undefined {
  const event = record(value)
  if (event.app_id !== appId) return undefined
  const operator = record(event.operator), context = record(event.context), action = record(event.action)
  if (typeof operator.open_id !== 'string' || !/^ou_[A-Za-z0-9]+$/.test(operator.open_id)
    || typeof context.open_chat_id !== 'string' || !/^oc_[A-Za-z0-9]+$/.test(context.open_chat_id)
    || typeof context.open_message_id !== 'string' || !/^om_[A-Za-z0-9]+$/.test(context.open_message_id)) return undefined
  return { appId, senderId: operator.open_id, chatId: context.open_chat_id, messageId: context.open_message_id,
    value: record(action.value), form: action.form_value === undefined ? {} : record(action.form_value) }
}

export type ConnectionState = 'unconfigured' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped'

/** The SDK owns reconnect timers; this wrapper owns request cancellation and awaited startup. */
export class FeishuEvents {
  constructor(private readonly api: FeishuApi, private readonly startupTimeoutMs: number) {}

  async consume(receive: (message: IncomingMessage) => void, action: (event: CardAction) => boolean,
    state: (value: ConnectionState) => void, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const lifetime = new AbortController()
    const combined = AbortSignal.any([signal, lifetime.signal])
    const ended = Promise.withResolvers<void>()
    const stop = () => { ended.resolve() }
    combined.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(() => { ended.reject(new Error('feishu-im: connection readiness timed out')) }, this.startupTimeoutMs)
    const { appId, appSecret, apiOrigin } = this.api.options
    const rejectEvent = () => { process.stderr.write('feishu-im: rejected malformed event\n') }
    const dispatcher = new EventDispatcher({ logger }).register({
      'im.message.receive_v1': (data: unknown) => {
        if (combined.aborted) return
        try { const message = parseFeishuMessage(data, appId); if (message) receive(message) } catch { rejectEvent() }
      },
      'card.action.trigger': (data: unknown) => {
        let accepted = false
        if (!combined.aborted) {
          try { const event = parseCardAction(data, appId); if (event) accepted = action(event) } catch { rejectEvent() }
        }
        return { toast: { type: accepted ? 'success' : 'error', content: accepted ? '已提交 / Submitted' : '操作无效或已过期 / Invalid or expired' } }
      },
    })
    const sockets = new Map<Duplex, Promise<void>>()
    const requests = new Set<Promise<unknown>>()
    const agent = apiOrigin.startsWith('http:') ? new HttpAgent() : new HttpsAgent()
    const createConnection = agent.createConnection.bind(agent)
    agent.createConnection = (options, callback) => {
      combined.throwIfAborted()
      // Node's built-in HTTP/HTTPS agents synchronously return the created socket.
      const socket = createConnection(options, callback)!
      const closed = new Promise<void>(resolve => socket.once('close', () => { sockets.delete(socket); resolve() }))
      sockets.set(socket, closed)
      return socket
    }
    const client = new WSClient({ appId, appSecret, domain: apiOrigin, logger, source: 'dsh-feishu-im', agent,
      handshakeTimeoutMs: this.startupTimeoutMs,
      httpInstance: Object.assign(Object.create(defaultHttpInstance) as HttpInstance, { request: async <T = unknown, R = T, D = unknown>(opts: HttpRequestOptions<D>): Promise<R> => {
        const url = new URL(opts.url!)
        if (url.origin !== apiOrigin || url.pathname !== '/callback/ws/endpoint') throw new Error('feishu-im: unexpected SDK endpoint')
        const request = this.api.json(url.pathname, opts.data, combined)
        requests.add(request)
        try { return await request as R } finally { requests.delete(request) }
      } }),
      onReady: () => { clearTimeout(timer); if (!combined.aborted) state('connected') },
      onError: () => { ended.reject(new Error('feishu-im: Feishu connection failed; check credentials and long-connection configuration')) },
      onReconnecting: () => { if (!combined.aborted) state('reconnecting') },
      onReconnected: () => { if (!combined.aborted) state('connected') },
    })
    state('connecting')
    const started = client.start({ eventDispatcher: dispatcher }).catch(() => { ended.reject(new Error('feishu-im: SDK connection failed')) })
    try { await ended.promise } finally {
      lifetime.abort(); clearTimeout(timer); combined.removeEventListener('abort', stop)
      client.close({ force: true })
      agent.destroy()
      for (const socket of sockets.keys()) socket.destroy()
      await Promise.allSettled([started, ...requests, ...sockets.values()])
      state('stopped')
    }
  }
}
