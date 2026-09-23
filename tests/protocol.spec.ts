import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { Config, validateConfig } from '../src/config.ts'
import { conversationId, parseMessage, readLines, replyChunks } from '../src/protocol.ts'

const event = {
  type: 'im.message.receive_v1', message_id: 'om_1', chat_id: 'oc_1', sender_id: 'ou_1',
  sender_type: 'user', chat_type: 'p2p', message_type: 'text', content: '测试\n$(echo literal)',
}

describe('CLI message admission', () => {
  it('preserves decoded text and separates application, workspace, and human conversations', () => {
    const message = parseMessage(JSON.stringify(event))!
    expect(message.text).toBe(event.content)
    expect(conversationId('app', '/work', message)).toBe(conversationId('app', '/work', message))
    expect(conversationId('other', '/work', message)).not.toBe(conversationId('app', '/work', message))
    expect(conversationId('app', '/other', message)).not.toBe(conversationId('app', '/work', message))
  })

  it.each([{ sender_type: 'bot' }, { chat_type: 'group' }, { message_type: 'image' }, { type: 'other' }, { content: '  ' }])(
    'ignores unsupported events %j', (patch) => {
      expect(parseMessage(JSON.stringify({ ...event, ...patch }))).toBeUndefined()
    },
  )

  it.each(['{', 'null', '[]', JSON.stringify({ ...event, message_id: '--bad' }), JSON.stringify({ ...event, content: {} })])(
    'rejects malformed wire data %s', (value) => { expect(() => parseMessage(value)).toThrow() },
  )

  it('bounds complete UTF-8 JSON reply content including escapes', () => {
    const text = '中🙂\\"\n'.repeat(100)
    const chunks = replyChunks(text, 64)
    expect(chunks.join('')).toBe(text)
    for (const chunk of chunks) expect(Buffer.byteLength(JSON.stringify({ text: chunk }))).toBeLessThanOrEqual(64)
    expect(replyChunks('', 64)).toEqual([])
    expect(() => replyChunks('中', 12)).toThrow('code point')
  })

  it('decodes partial UTF-8, CRLF, and the last unterminated record', async () => {
    const bytes = Buffer.from('中\r\nlast')
    const lines: string[] = []
    for await (const line of readLines(Readable.from([bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)]), 8)) {
      lines.push(line)
    }
    expect(lines).toEqual(['中', 'last'])
  })

  it.each(['oversized\n', 'oversized'])('rejects oversized records: %s', async (text) => {
    await expect(async () => {
      for await (const line of readLines(Readable.from([Buffer.from(text)]), 4)) void line
    }).rejects.toThrow('maxRecordBytes')
  })

  it('rejects non-byte streams and bounds a final incomplete UTF-8 sequence', async () => {
    for (const stream of [Readable.from(['text']), Readable.from([Buffer.from([0xe4])])]) {
      await expect(async () => {
        for await (const line of readLines(stream, 2)) void line
      }).rejects.toThrow('feishu-im:')
    }
  })

  it('requires explicit authorization and a working directory', () => {
    const request = { profile: 'test', cwd: process.cwd(), allowedUsers: ['ou_1'] }
    const config = Config(request)
    expect(() => { validateConfig(config) }).not.toThrow()
    for (const patch of [{ profile: '' }, { command: [] }, { cwd: 'relative' }, { allowedUsers: [] }, { allowedUsers: ['all'] }]) {
      expect(() => { validateConfig(Object.assign(Config(request), patch)) }).toThrow()
    }
    expect(() => Config({ ...request, maxConversations: 0 })).toThrow()
    expect(() => Config({ ...request, maxReplyBytes: 16_001 })).toThrow()
  })
})
