/** Lark CLI wire parsing and bounded reply encoding. */

import { createHash } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Feishu message identity validated at the CLI output parser. */
export type LarkMessageId = string & Branded<'LarkMessageId'>
/** Feishu private-chat identity. */
export type LarkChatId = string & Branded<'LarkChatId'>
/** Feishu human open_id. */
export type LarkUserId = string & Branded<'LarkUserId'>

/** Admitted private text message; CLI content is already decoded. */
export interface IncomingMessage {
  messageId: LarkMessageId
  chatId: LarkChatId
  senderId: LarkUserId
  text: string
}

/**
 * Decode one CLI record, ignoring non-human, non-private, or non-text events.
 * @param line - one complete JSON record.
 * @returns a validated message or undefined for an unsupported event.
 * @throws for malformed JSON or malformed supported message fields.
 */
export function parseMessage(line: string): IncomingMessage | undefined {
  const value: unknown = JSON.parse(line)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('feishu-im: event must be an object')
  }
  const record = value as Record<string, unknown>
  if (record['type'] !== 'im.message.receive_v1' || record['sender_type'] !== 'user'
    || record['chat_type'] !== 'p2p' || record['message_type'] !== 'text') return undefined
  const messageId = record['message_id']
  const chatId = record['chat_id']
  const senderId = record['sender_id']
  const text = record['content']
  if (typeof messageId !== 'string' || !/^om_[A-Za-z0-9]+$/.test(messageId)
    || typeof chatId !== 'string' || !/^oc_[A-Za-z0-9]+$/.test(chatId)
    || typeof senderId !== 'string' || !/^ou_[A-Za-z0-9]+$/.test(senderId)
    || typeof text !== 'string') throw new Error('feishu-im: invalid private text message fields')
  if (text.trim() === '') return undefined
  return {
    messageId: brandString<LarkMessageId>(messageId),
    chatId: brandString<LarkChatId>(chatId),
    senderId: brandString<LarkUserId>(senderId),
    text,
  }
}

/**
 * Derive a private Session identity without retaining raw chat identifiers in paths.
 * @param profile - pinned lark-cli application profile.
 * @param cwd - configured task directory.
 * @param message - private conversation participants.
 * @returns a stable Session id for this application, directory, and conversation.
 */
export function conversationId(profile: string, cwd: string, message: IncomingMessage): SessionId {
  return brandString<SessionId>(`lark-${createHash('sha256')
    .update(JSON.stringify([profile, cwd, message.chatId, message.senderId])).digest('hex')}`)
}

/**
 * Read UTF-8 lines without allowing an unterminated record to grow without bound.
 * @param stream - owned subprocess output stream.
 * @param maxBytes - maximum UTF-8 bytes per line, excluding its newline.
 * @returns complete lines, including a final unterminated line.
 */
export async function* readLines(stream: Readable, maxBytes: number): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error('feishu-im: expected byte output')
    const parts = (pending + decoder.write(chunk)).split('\n')
    pending = parts.pop() as string
    for (const line of parts) {
      if (Buffer.byteLength(line) > maxBytes) throw new Error('feishu-im: CLI record exceeds maxRecordBytes')
      yield line.replace(/\r$/, '')
    }
    if (Buffer.byteLength(pending) > maxBytes) throw new Error('feishu-im: CLI record exceeds maxRecordBytes')
  }
  pending += decoder.end()
  if (Buffer.byteLength(pending) > maxBytes) throw new Error('feishu-im: CLI record exceeds maxRecordBytes')
  if (pending !== '') yield pending.replace(/\r$/, '')
}

/**
 * Split text by code point while bounding the complete JSON content sent to Feishu.
 * @param text - literal reply content.
 * @param maxBytes - maximum UTF-8 bytes of each serialized `{text}` value.
 * @returns ordered nonempty reply chunks.
 */
export function replyChunks(text: string, maxBytes: number): string[] {
  const overhead = Buffer.byteLength(JSON.stringify({ text: '' }))
  const result: string[] = []
  let current = ''
  let bytes = overhead
  for (const character of text) {
    const size = Buffer.byteLength(JSON.stringify(character)) - 2
    if (overhead + size > maxBytes) throw new Error('feishu-im: maxReplyBytes cannot hold a code point')
    if (bytes + size > maxBytes) {
      result.push(current)
      current = ''
      bytes = overhead
    }
    current += character
    bytes += size
  }
  if (current !== '') result.push(current)
  return result
}
