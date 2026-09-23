/** Authenticated configuration and explicit private-chat pairing; never imports local secrets. */
import { randomBytes } from 'node:crypto'
import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { registerFeishuApp } from './registration.ts'
import QRCode from 'qrcode'
import { Config, validateConfig } from './config.ts'
import { FeishuApi, record } from './feishu-api.ts'
import type { FeishuRuntime } from './runtime.ts'
import type { IncomingMessage } from './protocol.ts'

export const REQUIRED_SCOPES = ['im:message:send_as_bot', 'im:message.p2p_msg:readonly']
export const REQUIRED_EVENTS = ['im.message.receive_v1']
export const REQUIRED_CALLBACKS = ['card.action.trigger']

function fail(code: string): never { throw new Error(`feishu-im: ${code}`) }
function string(value: unknown): string { if (typeof value !== 'string') return fail('invalid_fields'); return value.trim() }

export async function checkWorkspace(cwd: string, profile?: string): Promise<void> {
  if (!isAbsolute(cwd)) fail('invalid_workspace')
  try {
    cwd = await realpath(cwd)
    if (profile) profile = await realpath(profile)
    if (!(await stat(cwd)).isDirectory()) fail('invalid_workspace')
    await access(cwd, constants.R_OK | constants.W_OK)
  } catch { fail('invalid_workspace') }
  if (profile) {
    const path = relative(profile, cwd)
    if (!path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))) fail('profile_is_not_workspace')
  }
}

export class SetupManager {
  private readonly lifetime = new AbortController()
  private readonly work = new Set<Promise<unknown>>()
  private qr?: { controller: AbortController; done: Promise<void>; state: string; image?: string; expiresAt?: number }
  private pair?: { code: string; expiresAt: number; appId: string; revision: number }

  constructor(private readonly ctx: Context, private readonly runtime: FeishuRuntime, private readonly config: () => Config,
    private readonly register: typeof registerFeishuApp = registerFeishuApp) {}

  private descriptor() {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === 'feishu-im')
    if (!descriptor) fail('settings_unavailable')
    return descriptor
  }

  status() {
    const { appSecret, ...config } = this.config()
    const descriptor = this.descriptor()
    return { config, hasSecret: Boolean(appSecret), writable: this.ctx.settings.writable, revision: descriptor.revision,
      state: this.runtime.state, error: this.runtime.error,
      qr: this.qr ? { state: this.qr.state, image: this.qr.image, expiresAt: this.qr.expiresAt } : null,
      pairing: this.pair && this.pair.expiresAt > Date.now() ? { code: this.pair.code, expiresAt: this.pair.expiresAt } : null }
  }

  private revision(payload: Record<string, unknown>): number {
    const revision = payload.revision
    if (!Number.isSafeInteger(revision) || revision !== this.descriptor().revision) fail('settings_changed')
    if (!this.ctx.settings.writable) fail('settings_readonly')
    return revision as number
  }

  private async save(config: Config, revision: number, signal: AbortSignal): Promise<void> {
    validateConfig(config)
    const document = this.ctx.settings.documentPath
    await checkWorkspace(config.cwd, document ? dirname(document) : undefined)
    const api = new FeishuApi(config)
    try { await api.probe(signal) } catch { fail('bot_authentication_failed') } finally { await api.close() }
    signal.throwIfAborted()
    try { await this.ctx.settings.update('feishu-im', { account: config }, revision) }
    catch { fail('settings_changed') }
    this.pair = undefined
  }

  call(endpoint: string, raw: unknown, signal: AbortSignal): Promise<unknown> {
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    const work = this.dispatch(endpoint, record(raw), combined)
    this.work.add(work)
    return work.finally(() => { this.work.delete(work) })
  }

  private async dispatch(endpoint: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    if (endpoint === 'status') return this.status()
    if (endpoint === 'qrCancel') { await this.cancelQR(); return this.status() }
    const revision = this.revision(payload)
    if (endpoint === 'save') {
      await this.cancelQR()
      const current = this.config(), appId = string(payload.appId), supplied = string(payload.appSecret ?? '')
      const secret = supplied || (appId === current.appId ? current.appSecret : '')
      const users = payload.allowedUsers
      if (!Array.isArray(users) || users.some(id => typeof id !== 'string')) fail('invalid_fields')
      const config = Config({ ...current, appId, appSecret: secret, cwd: string(payload.cwd),
        apiOrigin: payload.region === 'lark' ? 'https://open.larksuite.com' : current.apiOrigin === 'https://open.larksuite.com' ? 'https://open.feishu.cn' : current.apiOrigin,
        allowedUsers: [...new Set(users as string[])], locale: payload.locale === 'en' ? 'en' : 'zh-CN' })
      await this.save(config, revision, signal)
    } else if (endpoint === 'disconnect') {
      await this.cancelQR(); this.pair = undefined
      await this.ctx.settings.update('feishu-im', { account: { ...this.config(), appId: '', appSecret: '', allowedUsers: [] } }, revision)
    } else if (endpoint === 'pairStart') {
      if (!this.config().appId || this.runtime.state !== 'connected') fail('not_connected')
      this.pair = { code: randomBytes(8).toString('hex'), expiresAt: Date.now() + 600_000, appId: this.config().appId, revision }
    } else if (endpoint === 'qrStart') {
      await this.cancelQR()
      const cwd = string(payload.cwd)
      await checkWorkspace(cwd, this.ctx.settings.documentPath ? dirname(this.ctx.settings.documentPath) : undefined)
      const controller = new AbortController()
      const qr = { controller, state: 'starting', done: Promise.resolve(), image: undefined as string | undefined, expiresAt: undefined as number | undefined }
      this.qr = qr
      const registrationSignal = AbortSignal.any([controller.signal, this.lifetime.signal, AbortSignal.timeout(600_000)])
      qr.done = (async () => {
        const result = await this.register({ source: 'dsh-feishu-im', createOnly: true, signal: registrationSignal,
          appPreset: { name: 'dsh', desc: 'Use dsh from private Feishu conversations' },
          addons: { preset: false, scopes: { tenant: REQUIRED_SCOPES }, events: { items: { tenant: REQUIRED_EVENTS } }, callbacks: { items: REQUIRED_CALLBACKS } },
          onQRCodeReady: info => {
            if (registrationSignal.aborted) return
            const url = new URL(info.url)
            if (url.protocol !== 'https:' || !['accounts.feishu.cn', 'accounts.larksuite.com'].includes(url.hostname)) { controller.abort(); return }
            qr.expiresAt = Date.now() + info.expireIn * 1000
            const rendering = QRCode.toDataURL(info.url, { width: 256, margin: 2 }).then(image => {
              if (!registrationSignal.aborted && qr.state === 'starting') { qr.image = image; qr.state = 'waiting' }
            })
            this.work.add(rendering); void rendering.catch(() => { controller.abort() }).finally(() => { this.work.delete(rendering) })
          },
        })
        registrationSignal.throwIfAborted()
        const openId = result.user_info?.open_id
        const account = Config({ ...this.config(), cwd, appId: result.client_id, appSecret: result.client_secret,
          apiOrigin: result.user_info?.tenant_brand === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn',
          allowedUsers: openId && /^ou_[A-Za-z0-9]+$/.test(openId) ? [openId] : [] })
        await this.save(account, revision, registrationSignal)
        qr.state = 'complete'; qr.image = undefined
      })().catch(() => { qr.state = controller.signal.aborted ? 'cancelled' : 'failed'; qr.image = undefined })
    } else fail('unknown_endpoint')
    return this.status()
  }

  receive(message: IncomingMessage, account: Config): boolean {
    if (!message.text.trim().startsWith('/dsh pair')) return false
    const pair = this.pair
    if (!pair || pair.appId !== account.appId || pair.expiresAt <= Date.now() || message.text.trim() !== `/dsh pair ${pair.code}`) return true
    this.pair = undefined
    const work = (async () => {
      await this.ctx.settings.update('feishu-im', { account: { ...account, allowedUsers: [...new Set([...account.allowedUsers, message.senderId])] } }, pair.revision)
      const api = new FeishuApi(account)
      try { await api.reply(message.messageId, 'paired', account.locale === 'en' ? 'Paired. Send a task to start.' : '授权成功，现在可以发送任务了。', this.lifetime.signal) }
      finally { await api.close() }
    })().catch(() => { process.stderr.write('feishu-im: pairing failed; refresh the configuration page\n') })
    this.work.add(work); void work.finally(() => { this.work.delete(work) })
    return true
  }

  private async cancelQR(): Promise<void> {
    this.qr?.controller.abort(); await this.qr?.done; this.qr = undefined
  }

  async dispose(): Promise<void> {
    this.lifetime.abort(); this.pair = undefined
    await this.cancelQR(); await Promise.allSettled(this.work)
  }
}
