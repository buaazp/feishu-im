/** Test-owned Feishu HTTP + protobuf WebSocket endpoint. No real external messages. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'

function varint(number: number): Buffer {
  const bytes: number[] = []
  do { const byte = number & 127; number = Math.floor(number / 128); bytes.push(byte | (number ? 128 : 0)) } while (number)
  return Buffer.from(bytes)
}
function field(id: number, value: Buffer): Buffer { return Buffer.concat([varint(id * 8 + 2), varint(value.length), value]) }
// Official SDK pbbp2.Frame wire schema: headers=5, payload=8; Header key=1,value=2.
function frame(event: unknown): Buffer {
  return Buffer.concat([Buffer.from([8, 1, 16, 1, 24, 1, 32, 1]),
    ...Object.entries({ type: 'event', message_id: randomUUID(), sum: '1', seq: '0' }).map(([key, value]) =>
      field(5, Buffer.concat([field(1, Buffer.from(key)), field(2, Buffer.from(value))]))),
    field(8, Buffer.from(JSON.stringify(event))),
  ])
}

export function nativeMessage(id: string, text: string, sender = 'ou_owner') {
  return { schema: '2.0', header: { event_type: 'im.message.receive_v1', event_id: `evt_${id}`, app_id: 'cli_0123456789abcdef' },
    event: { sender: { sender_type: 'user', sender_id: { open_id: sender } },
      message: { message_id: `om_${id}`, chat_id: 'oc_chat', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text }) } } }
}

export async function feishuFixture() {
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
  const messages: Array<{ id: string; replyTo: string; type: string; content: Record<string, unknown>; uuid: string }> = []
  const updates: Array<{ id: string; content: Record<string, unknown> }> = []
  const sockets = new Set<WebSocket>()
  let ready = true, handshakeReady = true
  const handshakes = new Set<Duplex>()
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString(), body = text ? JSON.parse(text) : {}
    const path = req.url!; calls.push({ method: req.method!, path, body })
    res.setHeader('content-type', 'application/json')
    if (path === '/callback/ws/endpoint') {
      if (!ready) return // Closed by fixture.close; models a pending discovery request.
      res.end(JSON.stringify({ code: 0, data: { URL: `${origin.replace('http:', 'ws:')}/events?device_id=test&service_id=1`,
        ClientConfig: { PingInterval: 60, ReconnectCount: -1, ReconnectInterval: 0.01, ReconnectNonce: 0 } } })); return
    }
    if (path.includes('tenant_access_token')) { res.end(JSON.stringify({ code: 0, tenant_access_token: 'fake-token', expire: 7200 })); return }
    if (path === '/open-apis/bot/v3/info') { res.end(JSON.stringify({ code: 0, bot: { open_id: 'ou_bot', app_name: 'Fixture bot' } })); return }
    if (path.endsWith('/reply')) {
      let message = messages.find(item => item.uuid === body.uuid)
      if (!message) {
        message = { id: `om_reply${messages.length + 1}`, replyTo: path.split('/').at(-2)!, type: body.msg_type,
          content: JSON.parse(body.content), uuid: body.uuid }; messages.push(message)
      }
      res.end(JSON.stringify({ code: 0, data: { message_id: message.id } })); return
    }
    if (req.method === 'PATCH' && path.startsWith('/open-apis/im/v1/messages/')) {
      updates.push({ id: path.split('/').at(-1)!, content: JSON.parse(body.content) })
      res.end(JSON.stringify({ code: 0 })); return
    }
    res.statusCode = 404; res.end('{}')
  })
  const ws = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    if (handshakeReady) ws.handleUpgrade(request, socket, head, connection => ws.emit('connection', connection, request))
    else { handshakes.add(socket); socket.once('close', () => handshakes.delete(socket)); socket.once('end', () => socket.end()); socket.resume() }
  })
  ws.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { origin, calls, messages, updates, sockets, handshakes,
    setHandshakeReady(value: boolean) { handshakeReady = value },
    setReady(value: boolean) { ready = value },
    send(event: unknown) { for (const socket of sockets) socket.send(frame(event)) },
    disconnect() { for (const socket of sockets) socket.terminate() },
    async close() {
      for (const socket of handshakes) socket.destroy()
      for (const socket of sockets) socket.terminate()
      await new Promise<void>((resolve, reject) => ws.close(error => error ? reject(error) : resolve()))
      server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}
