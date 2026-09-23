import { Context } from '@deepseek-ai/cordis'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import type { registerFeishuApp as registerApp } from '../src/registration.ts'
import QRCode from 'qrcode'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { FeishuApi } from '../src/feishu-api.ts'
import { SetupManager, checkWorkspace } from '../src/setup-manager.ts'
import { FeishuRuntime } from '../src/runtime.ts'
import { parseMessage } from '../src/protocol.ts'
import { incoming } from './fixture.ts'
import { feishuFixture } from './feishu-fixture.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
const appId = 'cli_0123456789abcdef'
async function harness(register?: typeof registerApp) {
  const root = await mkdtemp(join(tmpdir(), 'feishu-setup-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  const cwd = join(root, 'work'), profile = join(root, 'profile'); await mkdir(cwd); await mkdir(profile)
  const fixture = await feishuFixture(); cleanup.push(() => fixture.close())
  const ctx = new Context(); cleanup.push(() => ctx.fiber.dispose())
  let config = Config({ appId, appSecret: 'SECRET_DO_NOT_RETURN', cwd, apiOrigin: fixture.origin }), revision = 1
  const settings = { writable: true, documentPath: join(profile, 'cordis.patch.yml'),
    describe: vi.fn(() => [{ ns: 'feishu-im', revision }]),
    update: vi.fn(async (_ns: string, patch: { account: Partial<Config> }, expected?: number) => {
      if (expected !== revision) throw new Error('conflict')
      config = Config(patch.account); revision++
    }) }
  ctx.provide('settings', settings as unknown as SettingsForms)
  const runtime = new FeishuRuntime(ctx); runtime.state = 'connected'
  const manager = new SetupManager(ctx, runtime, () => config, register); cleanup.push(() => manager.dispose())
  const call = (endpoint: string, payload: object = {}) => manager.call(endpoint, { revision, ...payload }, new AbortController().signal)
  const form = (patch: object = {}) => ({ appId, appSecret: '', cwd, allowedUsers: [], ...patch })
  return { manager, runtime, settings, fixture, call, form, cwd, profile, get config() { return config }, get revision() { return revision } }
}

it('saves verified credentials atomically and never returns the secret; blank preserves only the same app', async () => {
  const h = await harness()
  expect(JSON.stringify(h.manager.status())).not.toContain('SECRET_DO_NOT_RETURN')
  await h.call('save', h.form({ allowedUsers: ['ou_owner', 'ou_owner'], locale: 'en' }))
  expect(h.config.allowedUsers).toEqual(['ou_owner']); expect(h.config.appSecret).toBe('SECRET_DO_NOT_RETURN'); expect(h.config.locale).toBe('en')
  await expect(h.call('save', h.form({ appId: 'cli_1111111111111111' }))).rejects.toThrow('App Secret')
  await h.call('save', h.form({ appSecret: undefined })); expect(h.config.appSecret).toBe('SECRET_DO_NOT_RETURN')
  const status = await h.call('status'); expect(JSON.stringify(status)).not.toContain('replacement')
  h.settings.update.mockRejectedValueOnce(new Error('conflict'))
  await expect(h.call('save', h.form())).rejects.toThrow('settings_changed')
})

it('rejects stale or read-only edits, invalid fields, inaccessible workspaces and failed credentials', async () => {
  const h = await harness()
  for (const revision of [0, 1.5, '1', undefined]) await expect(h.call('save', h.form({ revision }))).rejects.toThrow('settings_changed')
  h.settings.writable = false; await expect(h.call('disconnect')).rejects.toThrow('readonly'); h.settings.writable = true
  for (const patch of [{ appId: 3 }, { allowedUsers: 'all' }, { allowedUsers: [3] }, { cwd: 'relative' }, { cwd: h.profile }, { cwd: join(h.profile, 'nested') }]) await expect(h.call('save', h.form(patch))).rejects.toThrow()
  await expect(h.call('save', h.form({ cwd: join(h.cwd, 'missing') }))).rejects.toThrow('invalid_workspace')
  const file = join(h.cwd, 'file'); await writeFile(file, 'x'); await expect(checkWorkspace(file)).rejects.toThrow('invalid_workspace')
  await expect(checkWorkspace('relative')).rejects.toThrow('invalid_workspace')
  vi.spyOn(FeishuApi.prototype, 'probe').mockRejectedValueOnce(new Error('sensitive network error'))
  await expect(h.call('save', h.form())).rejects.toThrow('bot_authentication_failed')
  await expect(h.call('unknown')).rejects.toThrow('unknown_endpoint')
  h.settings.describe.mockReturnValue([]); expect(() => h.manager.status()).toThrow('settings_unavailable')
})

it('pairs exactly one human with a one-use expiring code and refuses stale app configuration', async () => {
  const h = await harness()
  h.runtime.state = 'connecting'; await expect(h.call('pairStart')).rejects.toThrow('not_connected'); h.runtime.state = 'connected'
  await h.call('pairStart'); const code = h.manager.status().pairing!.code
  const receive = (text: string, account = h.config, user = 'ou_owner') => h.manager.receive(parseMessage(JSON.stringify(incoming('pair', text, user)))!, account)
  expect(receive('normal task')).toBe(false)
  expect(receive('/dsh pair invalid')).toBe(true)
  expect(receive(`/dsh pair ${code}`, { ...h.config, appId: 'cli_1111111111111111' })).toBe(true)
  expect(h.settings.update).not.toHaveBeenCalled()
  receive(`/dsh pair ${code}`); receive(`/dsh pair ${code}`, h.config, 'ou_intruder')
  await vi.waitFor(() => expect(h.fixture.messages).toHaveLength(1))
  expect(h.config.allowedUsers).toEqual(['ou_owner']); expect(h.manager.status().pairing).toBeNull()
  await h.call('pairStart'); const expired = h.manager.status().pairing!.code
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 700000)
  expect(h.manager.status().pairing).toBeNull(); receive(`/dsh pair ${expired}`); now.mockRestore()
  expect(h.settings.update).toHaveBeenCalledTimes(1)
  await h.call('pairStart'); h.settings.update.mockRejectedValueOnce(new Error('stale'))
  receive(`/dsh pair ${h.manager.status().pairing!.code}`)
  await h.manager.dispose(); expect(h.config.allowedUsers).toEqual(['ou_owner'])
})

it('supports Lark switching, cancellation, disconnect and English pairing', async () => {
  const h = await harness()
  vi.spyOn(FeishuApi.prototype, 'probe').mockResolvedValue({ name: 'fake', openId: 'ou_bot' })
  await h.call('save', h.form({ region: 'lark' })); expect(h.config.apiOrigin).toBe('https://open.larksuite.com')
  await h.call('save', h.form()); expect(h.config.apiOrigin).toBe('https://open.feishu.cn')
  const reply = vi.spyOn(FeishuApi.prototype, 'reply').mockResolvedValue()
  await h.call('save', h.form({ locale: 'en' })); await h.call('pairStart')
  h.manager.receive(parseMessage(JSON.stringify(incoming('pair', `/dsh pair ${h.manager.status().pairing!.code}`)))!, h.config)
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith('om_pair', 'paired', expect.stringContaining('Paired'), expect.any(AbortSignal)))
  await h.call('disconnect'); expect(h.config.appSecret).toBe(''); expect(h.config.allowedUsers).toEqual([])
  await expect(h.call('pairStart')).rejects.toThrow('not_connected')
  await h.call('qrCancel'); await h.manager.dispose()
  expect(() => h.call('status')).toThrow()
})

it('uses official QR registration with minimal scopes and binds only the returned scanner', async () => {
  let request: Parameters<typeof registerApp>[0] | undefined
  const result = Promise.withResolvers<Awaited<ReturnType<typeof registerApp>>>()
  const register = vi.fn<typeof registerApp>(options => { request = options; return result.promise })
  const h = await harness(register)
  vi.spyOn(FeishuApi.prototype, 'probe').mockResolvedValue({ name: 'QR bot', openId: 'ou_bot' })
  await h.call('qrStart', { cwd: h.cwd })
  expect(request).toMatchObject({ createOnly: true, source: 'dsh-feishu-im', addons: { preset: false, scopes: { tenant: ['im:message:send_as_bot', 'im:message.p2p_msg:readonly'] }, callbacks: { items: ['card.action.trigger'] } } })
  request!.onQRCodeReady({ url: 'https://accounts.feishu.cn/confirm?code=fake', expireIn: 60 })
  await vi.waitFor(() => expect(h.manager.status().qr?.image).toMatch(/^data:image\/png;base64,/))
  result.resolve({ client_id: appId, client_secret: 'QR_SECRET', user_info: { open_id: 'ou_scanner', tenant_brand: 'lark' } })
  await vi.waitFor(() => expect(h.manager.status().qr?.state).toBe('complete'))
  expect(h.config.allowedUsers).toEqual(['ou_scanner']); expect(h.config.apiOrigin).toBe('https://open.larksuite.com')
  expect(JSON.stringify(h.manager.status())).not.toContain('QR_SECRET')
})

it.each([undefined, { open_id: 'invalid' }])('leaves QR setup closed when no valid scanner identity is returned (%j)', async user_info => {
  const h = await harness(async () => ({ client_id: appId, client_secret: 'fake', user_info }))
  vi.spyOn(FeishuApi.prototype, 'probe').mockResolvedValue({ name: 'bot', openId: 'ou_bot' })
  h.settings.documentPath = ''
  await h.call('qrStart', { cwd: h.cwd }); await vi.waitFor(() => expect(h.manager.status().qr?.state).toBe('complete'))
  expect(h.config.allowedUsers).toEqual([]); expect(h.config.apiOrigin).toBe('https://open.feishu.cn')
})

it('cancels pending registration, rejects unsafe QR URLs and contains registration failure', async () => {
  let options: Parameters<typeof registerApp>[0] | undefined
  const h = await harness(async request => {
    options = request
    return new Promise((_resolve, reject) => request.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  })
  await h.call('qrStart', { cwd: h.cwd })
  options!.onQRCodeReady({ url: 'https://attacker.example/qr', expireIn: 60 })
  await vi.waitFor(() => expect(h.manager.status().qr?.state).toBe('cancelled'))
  options!.onQRCodeReady({ url: 'https://accounts.feishu.cn/late', expireIn: 60 })
  await h.call('qrStart', { cwd: h.cwd }); await h.call('qrCancel'); expect(h.manager.status().qr).toBeNull()
  const failed = await harness(async () => { throw new Error('server error') })
  await failed.call('qrStart', { cwd: failed.cwd }); await vi.waitFor(() => expect(failed.manager.status().qr?.state).toBe('failed'))
})

it('rejects a workspace symlink into the profile', async () => {
  const h = await harness(), alias = join(h.cwd, 'profile-alias')
  await symlink(h.profile, alias)
  await expect(h.call('save', h.form({ cwd: alias }))).rejects.toThrow('profile_is_not_workspace')
})

it('does not let late QR rendering overwrite completed registration and cancels rendering failures', async () => {
  const image = Promise.withResolvers<string>()
  vi.spyOn(QRCode, 'toDataURL').mockImplementationOnce(() => image.promise)
  const h = await harness(async request => {
    request.onQRCodeReady({ url: 'https://accounts.feishu.cn/confirm', expireIn: 60 })
    return { client_id: appId, client_secret: 'fake' }
  })
  vi.spyOn(FeishuApi.prototype, 'probe').mockResolvedValue({ name: 'bot', openId: 'ou_bot' })
  await h.call('qrStart', { cwd: h.cwd })
  await vi.waitFor(() => expect(h.manager.status().qr?.state).toBe('complete'))
  image.resolve('data:image/png;base64,fake'); await image.promise; await Promise.resolve()
  expect(h.manager.status().qr).toMatchObject({ state: 'complete', image: undefined })
  await h.manager.dispose()
  // A rendering failure must abort and join the registration request.
  vi.mocked(QRCode.toDataURL).mockImplementationOnce(() => Promise.reject(new Error('render failed')))
  const failure = await harness(async request => {
    request.onQRCodeReady({ url: 'https://accounts.feishu.cn/confirm', expireIn: 60 })
    return new Promise((_resolve, reject) => request.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  })
  await failure.call('qrStart', { cwd: failure.cwd })
  await vi.waitFor(() => expect(failure.manager.status().qr?.state).toBe('cancelled'))
})
