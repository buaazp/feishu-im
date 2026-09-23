import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { Config, configurationSchema, LiveConfig } from '../src/config.ts'
import { bindSettings, readAccount } from '../src/settings-compat.ts'

it('uses live Config references on newer dsh and returns independent account snapshots', async () => {
  const ctx = new Context()
  const release = vi.fn(), configure = vi.fn(() => release)
  ctx.provide('settings', { configure } as unknown as Context['settings'])
  const config = LiveConfig({ account: Config({ allowedUsers: ['ou_owner'] }) })
  try {
    const read = bindSettings(ctx, ctx, config, vi.fn())
    expect(configure).toHaveBeenCalledWith({ auto: false }, ctx.fiber)
    const value = read(); value.allowedUsers.push('ou_other')
    expect(readAccount(config).allowedUsers).toEqual(['ou_owner'])
  } finally { await ctx.fiber.dispose() }
  expect(release).toHaveBeenCalledOnce()
})

it('loads saved legacy settings, observes changes and releases its watcher at shutdown', async () => {
  const ctx = new Context(), base = Config({ cwd: '/base' })
  let stored = { account: Config({ cwd: '/saved', allowedUsers: ['ou_owner'] }) }
  let notify!: () => Promise<void>
  const release = vi.fn(), changed = vi.fn(async () => {})
  const register = vi.fn((_ns, schema, options) => {
    expect(schema(options.base)).toEqual({ account: base })
    return { get: () => stored, watch: (callback: typeof notify) => { notify = callback; return release } }
  })
  ctx.provide('settings', { register } as unknown as Context['settings'])
  try {
    const read = bindSettings(ctx, ctx, { account: base }, changed)
    expect(register.mock.calls[0]![0]).toBe('feishu-im')
    expect(read().cwd).toBe('/saved')
    stored = { account: Config({ cwd: '/replacement' }) }; await notify()
    expect(changed).toHaveBeenCalledWith(stored.account)
    expect(read().cwd).toBe('/replacement')
  } finally { await ctx.fiber.dispose() }
  expect(release).toHaveBeenCalledOnce()
})

it('accepts the public pre-volatile schema without invoking an unavailable method', () => {
  const account = Config.default(Config({}))
  Object.defineProperty(account, 'volatile', { value: undefined })
  const schema = Object.assign((input: Partial<Config>) => Config(input), { default: () => account }) as unknown as typeof Config
  const parsed = configurationSchema(schema)({ account: Config({ cwd: '/legacy' }) })
  expect(readAccount(parsed).cwd).toBe('/legacy')
})
