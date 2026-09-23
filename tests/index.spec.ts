import { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, Config as PluginConfig } from '../src/index.ts'
import { Config } from '../src/config.ts'
import { FeishuRuntime } from '../src/runtime.ts'
import { createDriverHarness } from './driver-harness.ts'
import { feishuFixture, nativeMessage } from './feishu-fixture.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
it('requires the profile launcher, while unconfigured installation does not stop dsh', async () => {
  const ctx = new Context(); cleanup.push(() => ctx.fiber.dispose())
  expect(() => apply(ctx, PluginConfig({}))).toThrow('launch through a dsh profile')
  const exit = vi.fn(); provideCmdline(ctx, { args: [], exit })
  apply(ctx, PluginConfig({})); await ctx.fiber.dispose(); expect(exit).not.toHaveBeenCalled()
})
it('connects through the real SDK, handles messages and drains account replacement and shutdown', async () => {
  const fixture = await feishuFixture(); cleanup.push(() => fixture.close())
  const h = await createDriverHarness(cleanup, { apiOrigin: fixture.origin })
  const runtime = new FeishuRuntime(h.ctx); cleanup.push(() => runtime.dispose())
  await runtime.configure(h.config)
  await vi.waitFor(() => expect(runtime.state).toBe('connected'))
  fixture.send(nativeMessage('one', '/dsh help'))
  await vi.waitFor(() => expect(fixture.messages.some(row => JSON.stringify(row.content).includes('/dsh status'))).toBe(true))
  runtime.onMessage = () => true
  fixture.send(nativeMessage('suppressed', 'never admit'))
  const replace = runtime.configure(Config({})); await runtime.configure(Config({ appId: 'invalid' })); await replace
  expect(runtime.state).toBe('error'); expect(runtime.error).toBe('invalid_configuration')
  await runtime.configure(Config({})); expect(runtime.state).toBe('unconfigured')
  await runtime.configure(h.config); await vi.waitFor(() => expect(runtime.state).toBe('connected'))
  await runtime.dispose(); await vi.waitFor(() => expect(fixture.sockets.size).toBe(0))
  await runtime.configure(h.config); expect(runtime.state).toBe('stopped')
})
it('keeps the app alive after connection failure and cancels pending discovery', async () => {
  const fixture = await feishuFixture(); cleanup.push(() => fixture.close()); fixture.setReady(false)
  const h = await createDriverHarness(cleanup, { apiOrigin: fixture.origin, startupTimeoutMs: 20 })
  const runtime = new FeishuRuntime(h.ctx); cleanup.push(() => runtime.dispose())
  await runtime.configure(h.config); await vi.waitFor(() => expect(runtime.state).toBe('error'))
  expect(runtime.error).toBe('connection_failed')
  await runtime.configure({ ...h.config, startupTimeoutMs: 30000 }); await runtime.dispose()
  expect(runtime.state).toBe('stopped')
})

it('registers authenticated shared-channel routes with validated envelopes and safe error responses', async () => {
  const { brandString } = await import('@deepseek-ai/dsh-brand')
  const h = await createDriverHarness(cleanup)
  provideCmdline(h.ctx, { args: [], exit: vi.fn() })
  const routes: import('@deepseek-ai/dsh-client-connection').ConnectionFetchRoute[] = []
  const remove = vi.fn(async () => {})
  const settings = { configure: vi.fn(() => vi.fn()), describe: vi.fn(() => [{ ns: brandString<import('@deepseek-ai/dsh-settings').SettingsNamespace>('feishu-im'), revision: 1 }]), writable: true, documentPath: '' }
  h.ctx.provide('settings', settings as unknown as import('@deepseek-ai/dsh-settings').SettingsForms)
  h.ctx.provide('connection', { fetch: { register: (route: typeof routes[number]) => { routes.push(route); return remove } } } as unknown as import('@deepseek-ai/dsh-client-connection').HostConnectionHandle)
  const configure = vi.spyOn(FeishuRuntime.prototype, 'configure').mockResolvedValue()
  try {
    apply(h.ctx, PluginConfig({}))
    await vi.waitFor(() => expect(routes).toHaveLength(6))
    await vi.waitFor(() => expect(configure).toHaveBeenCalled())
    h.ctx.emit('loader/volatile-update', [])
    const route = routes.find(route => route.path.endsWith('/status'))!
    const request = (body: unknown) => route.fetch(new Request(`http://localhost${route.path}`, { method: 'POST', body: JSON.stringify(body) }))
    expect((await request({})).status).toBe(400)
    expect((await request({ type: 'client-request', rpcId: 'one', method: 'wrong', payload: {} })).status).toBe(400)
    const envelope = { type: 'client-request', rpcId: 'one', method: 'feishu-im/status', payload: {} }
    expect(await (await request(envelope)).json()).toMatchObject({ result: { ok: true, value: { hasSecret: false } } })
    expect(await (await request({ ...envelope, payload: null })).json()).toMatchObject({ result: { ok: false, error: { code: 'invalid API response' } } })
    settings.describe.mockImplementationOnce(() => { throw 'SECRET_FROM_EXTERNAL_ERROR' })
    expect(await (await request(envelope)).json()).toMatchObject({ result: { ok: false, error: { code: 'configuration_failed' } } })
    const message = (await import('../src/protocol.ts')).parseMessage(JSON.stringify((await import('./fixture.ts')).incoming('pair', '/dsh pair invalid')))!
    expect((configure.mock.contexts.at(-1) as FeishuRuntime).onMessage?.(message, h.config)).toBe(true)
    await h.ctx.fiber.dispose(); expect(remove).toHaveBeenCalledTimes(6)
  } finally { configure.mockRestore() }
})

it('detaches live updates from the caller async transaction and drains callbacks on abort', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks')
  const { FeishuEvents } = await import('../src/feishu-events.ts')
  const { FeishuDriver } = await import('../src/driver.ts')
  const { parseMessage } = await import('../src/protocol.ts')
  const { incoming } = await import('./fixture.ts')
  const h = await createDriverHarness(cleanup), transaction = new AsyncLocalStorage<string>()
  const runtime = new FeishuRuntime(h.ctx); cleanup.push(() => runtime.dispose())
  let callbacks: Parameters<import('../src/feishu-events.ts').FeishuEvents['consume']>
  const consume = vi.spyOn(FeishuEvents.prototype, 'consume').mockImplementation(async (...args) => {
    expect(transaction.getStore()).toBeUndefined(); callbacks = args
    return new Promise((_resolve, reject) => args[3].addEventListener('abort', () => reject(new Error('closed')), { once: true }))
  })
  const receive = vi.spyOn(FeishuDriver.prototype, 'receive').mockImplementation(() => {})
  try {
    await transaction.run('settings-update', () => runtime.configure(h.config))
    const message = parseMessage(JSON.stringify(incoming('one', 'task')))!
    callbacks![0](message)
    runtime.onMessage = () => false; callbacks![0](message)
    runtime.onMessage = () => true; callbacks![0](message)
    expect(receive).toHaveBeenCalledTimes(2)
    expect(callbacks![1]({ appId: h.config.appId, senderId: 'ou_owner', chatId: 'oc_private', messageId: 'om_unknown', value: {}, form: {} })).toBe(false)
    callbacks![2]('connected'); expect(runtime.state).toBe('connected')
    await runtime.dispose(); expect(runtime.error).toBe('')
  } finally { consume.mockRestore(); receive.mockRestore() }
})

it('waits for the profile loader and cancels startup while that loader is pending', async () => {
  const ctx = new Context(), loaded = Promise.withResolvers<void>()
  cleanup.push(() => ctx.fiber.dispose())
  provideCmdline(ctx, { args: [], exit: vi.fn() })
  ctx.provide('loader', { await: () => loaded.promise } as unknown as import('@deepseek-ai/cordis-plugin-loader').default)
  const configure = vi.spyOn(FeishuRuntime.prototype, 'configure').mockResolvedValue()
  try {
    apply(ctx, PluginConfig({})); const closed = ctx.fiber.dispose()
    loaded.resolve(); await closed; expect(configure).not.toHaveBeenCalled()
  } finally { configure.mockRestore() }
})

it('reconfigures the runtime from legacy settings changes and detaches the watcher', async () => {
  const h = await createDriverHarness(cleanup)
  provideCmdline(h.ctx, { args: [], exit: vi.fn() })
  let current = Config({}), notify!: () => Promise<void>
  const release = vi.fn()
  h.ctx.provide('settings', { register: () => ({ get: () => ({ account: current }), watch: (callback: typeof notify) => { notify = callback; return release } }) } as unknown as Context['settings'])
  h.ctx.provide('connection', { fetch: { register: () => async () => {} } } as unknown as Context['connection'])
  const configure = vi.spyOn(FeishuRuntime.prototype, 'configure').mockResolvedValue()
  try {
    apply(h.ctx, { account: Config({}) })
    await vi.waitFor(() => expect(configure).toHaveBeenCalledWith(current))
    current = h.config; await notify()
    expect(configure).toHaveBeenLastCalledWith(h.config)
    await h.ctx.fiber.dispose(); expect(release).toHaveBeenCalledOnce()
  } finally { configure.mockRestore() }
})
