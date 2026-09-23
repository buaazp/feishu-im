/** Test-owned TCP endpoint used only by the fake external Lark CLI. */
import { createServer, type Socket } from 'node:net'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'

export interface Reply {
  messageId: string
  text: string
  uuid: string
  args: string[]
}

export async function larkFixture() {
  const sockets = new Set<Socket>()
  const consumers = new Set<Socket>()
  const replies: Reply[] = []
  let acknowledge: (reply: Reply) => { reply: unknown; exitCode?: number } | undefined = () => ({ reply: { ok: true } })
  let autoReady = true
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => { sockets.delete(socket); consumers.delete(socket) })
    const lines = createInterface({ input: socket })
    lines.on('line', (line) => {
      const data = JSON.parse(line) as { kind: string; args: string[] }
      if (data.kind === 'consume') {
        consumers.add(socket)
        if (autoReady) socket.write(JSON.stringify({ ready: true }) + '\n')
      } else {
        const value = (flag: string): string => data.args[data.args.indexOf(flag) + 1]!
        const reply = { messageId: value('--message-id'), text: value('--text'), uuid: value('--idempotency-key'), args: data.args }
        replies.push(reply)
        const response = acknowledge(reply)
        if (response !== undefined) socket.write(JSON.stringify(response) + '\n')
      }
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing fixture address')
  return {
    command: [process.execPath, fileURLToPath(new URL('./fixtures/lark-cli.mjs', import.meta.url)), String(address.port)],
    replies,
    consumers,
    setReady(value: boolean) { autoReady = value },
    setReply(handler: typeof acknowledge) { acknowledge = handler },
    async connected() { await vi.waitFor(() => { if (consumers.size === 0) throw new Error('consumer not connected') }, { timeout: 20_000 }) },
    send(event: unknown) { for (const socket of consumers) socket.write(JSON.stringify({ event }) + '\n') },
    output(stdout: string, stderr = '') { for (const socket of consumers) socket.write(JSON.stringify({ stdout, stderr }) + '\n') },
    ready() { for (const socket of consumers) socket.write(JSON.stringify({ ready: true }) + '\n') },
    exit(exitCode: number) { for (const socket of consumers) socket.write(JSON.stringify({ exitCode }) + '\n') },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    },
  }
}

export function incoming(id: string, content: string, sender = 'ou_owner') {
  return {
    type: 'im.message.receive_v1', message_id: `om_${id}`, chat_id: 'oc_private', sender_id: sender,
    sender_type: 'user', chat_type: 'p2p', message_type: 'text', content,
  }
}
