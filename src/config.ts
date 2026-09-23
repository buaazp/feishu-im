/** Direct Feishu bot credentials and bounded task settings. */
import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Locale } from './messages.ts'

export interface Config {
  locale: Locale
  appId: string
  appSecret: string
  apiOrigin: string
  /** Explicit old profile namespace, only for resuming pre-0.2 conversations. */
  legacyNamespace: string
  cwd: string
  allowedUsers: string[]
  maxConversations: number
  maxPendingMessages: number
  maxConcurrentReplies: number
  maxReplyBytes: number
  startupTimeoutMs: number
  requestTimeoutMs: number
  taskTimeoutMs: number
  progressIntervalMs: number
  interactionTimeoutMs: number
}
const positive = (): z<number> => z.number().min(1).max(2_147_483_647).step(1)
export const Config: z<Partial<Config>, Config> = z.object({
  locale: z.union(['zh-CN', 'en']).default('zh-CN'),
  appId: z.string().default(''),
  appSecret: z.string().role('secret').default(''),
  apiOrigin: z.string().default('https://open.feishu.cn'),
  legacyNamespace: z.string().default(''),
  cwd: z.string().default(''),
  allowedUsers: z.array(z.string()).default([]),
  maxConversations: positive().default(4),
  maxPendingMessages: positive().default(16),
  maxConcurrentReplies: positive().default(8),
  maxReplyBytes: z.number().min(64).max(16_000).step(1).default(12_000),
  startupTimeoutMs: positive().default(30_000),
  requestTimeoutMs: positive().default(30_000),
  taskTimeoutMs: positive().default(600_000),
  progressIntervalMs: positive().default(1_000),
  interactionTimeoutMs: positive().default(300_000),
})
/** Atomic, live account updates exposed through dsh's revisioned settings service. */
export const LiveConfig = z.object({ account: Config.default(Config({})).volatile() })
export type LiveConfig = ReturnType<typeof LiveConfig>

export function validateConfig(config: Config): void {
  if (!/^cli_[0-9a-fA-F]{16}$/.test(config.appId)) throw new Error('feishu-im: invalid App ID')
  if (!config.appSecret.trim()) throw new Error('feishu-im: App Secret is required')
  const url = new URL(config.apiOrigin)
  const official = ['https://open.feishu.cn', 'https://open.larksuite.com'].includes(url.origin)
  const local = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
  if ((!official && !local) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('feishu-im: use the official Feishu/Lark API origin')
  }
  if (!isAbsolute(config.cwd)) throw new Error('feishu-im: cwd must be absolute')
  if (config.allowedUsers.some(id => !/^ou_[A-Za-z0-9]+$/.test(id))) throw new Error('feishu-im: allowedUsers must contain human open_ids (ou_...)')
}
