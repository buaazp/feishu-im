/** Validated deployment settings for the Lark private-chat driver. */

import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Locale } from './messages.ts'

/** Lark CLI identity, task admission, and resource limits. */
export interface Config {
  /** Language of control messages, independently of model answers. Defaults to `zh-CN`. */
  locale: Locale
  /** Executable and fixed arguments; no shell expansion. Defaults to `['lark-cli']`. */
  command: string[]
  /** Existing lark-cli profile name, pinned for both receipt and replies. */
  profile: string
  /** Absolute working directory for tasks and the CLI. */
  cwd: string
  /** Human open_ids permitted to start tasks in private chats. */
  allowedUsers: string[]
  /** Maximum simultaneous private conversations. Defaults to 4. */
  maxConversations: number
  /** Maximum unstarted messages per conversation. Defaults to 16. */
  maxPendingMessages: number
  /** Maximum simultaneous status, queue, and failure reply requests. Defaults to 8. */
  maxConcurrentReplies: number
  /** Maximum bytes in one CLI NDJSON record or collected RPC stream. Defaults to 1048576. */
  maxRecordBytes: number
  /** Maximum UTF-8 bytes in each reply's JSON content, between 64 and 16000. Defaults to 12000. */
  maxReplyBytes: number
  /** Maximum wait in milliseconds for the event consumer's ready marker. Defaults to 30000. */
  startupTimeoutMs: number
  /** Maximum duration in milliseconds of one CLI reply request. Defaults to 30000. */
  requestTimeoutMs: number
  /** Maximum duration in milliseconds of one submitted task, including continuations. Defaults to 600000. */
  taskTimeoutMs: number
  /** Grace in milliseconds before managed subprocess termination. Defaults to 3000. */
  graceMs: number
}

const positive = (): z<number> => z.number().min(1).max(2_147_483_647).step(1)

/** Loader validation and explicit deployment defaults. */
export const Config: z<Partial<Config>, Config> = z.object({
  locale: z.union(['zh-CN', 'en']).default('zh-CN'),
  command: z.array(z.string()).default(['lark-cli']),
  profile: z.string().default(''),
  cwd: z.string().default(''),
  allowedUsers: z.array(z.string()).default([]),
  maxConversations: positive().default(4),
  maxPendingMessages: positive().default(16),
  maxConcurrentReplies: positive().default(8),
  maxRecordBytes: positive().default(1_048_576),
  maxReplyBytes: z.number().min(64).max(16_000).step(1).default(12_000),
  startupTimeoutMs: positive().default(30_000),
  requestTimeoutMs: positive().default(30_000),
  taskTimeoutMs: positive().default(600_000),
  graceMs: positive().default(3_000),
})

/**
 * Reject unusable executable, identity, path, and authorization settings at load.
 * @param config - schema-resolved plugin settings.
 */
export function validateConfig(config: Config): void {
  if (config.command.length === 0 || config.command.some(value => value.trim() === '')) {
    throw new Error('feishu-im: command requires an executable and nonblank arguments')
  }
  if (config.profile.trim() === '') throw new Error('feishu-im: configure a lark-cli profile first; run feishu-im setup')
  if (!isAbsolute(config.cwd)) throw new Error('feishu-im: cwd must be absolute')
  if (config.allowedUsers.length === 0 || config.allowedUsers.some(id => !/^ou_[A-Za-z0-9]+$/.test(id))) {
    throw new Error('feishu-im: allowedUsers requires explicit human open_ids (ou_...)')
  }
}
