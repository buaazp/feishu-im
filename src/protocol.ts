/** Private message validation and durable conversation identity. */

import { createHash } from 'node:crypto'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Feishu message identity validated at the message parser. */
export type LarkMessageId = string & Branded<'LarkMessageId'>
/** Feishu private-chat identity. */
export type LarkChatId = string & Branded<'LarkChatId'>
/** Feishu human open_id. */
export type LarkUserId = string & Branded<'LarkUserId'>

/** Admitted private text message; text content is already decoded. */
export interface IncomingMessage {
  messageId: LarkMessageId
  chatId: LarkChatId
  senderId: LarkUserId
  text: string
}

/**
 * Decode one normalized message, ignoring non-human, non-private, or non-text events.
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
 * @param profile - application id or explicit legacy namespace.
 * @param cwd - configured task directory.
 * @param message - private conversation participants.
 * @returns a stable Session id for this application, directory, and conversation.
 */
export function conversationId(profile: string, cwd: string, message: IncomingMessage): SessionId {
  return brandString<SessionId>(`lark-${createHash('sha256')
    .update(JSON.stringify([profile, cwd, message.chatId, message.senderId])).digest('hex')}`)
}
