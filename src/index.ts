/** Additive Feishu channel: the profile's existing dsh runner owns the application. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-settings'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { readJson } from './feishu-api.ts'
import { Config as AccountConfig, LiveConfig } from './config.ts'
import { FeishuRuntime } from './runtime.ts'
import { SetupManager } from './setup-manager.ts'

export { LiveConfig as Config } from './config.ts'
export const name = 'feishu-im'
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'sessionPersistence', 'sessionQuery']

export function apply(ctx: Context, config: LiveConfig): void {
  if (ctx.get('appExit') === undefined) throw new Error('feishu-im: launch through a dsh profile')
  const runtime = new FeishuRuntime(ctx)
  const account = (): AccountConfig => { const value = config.account.get(); return { ...value, allowedUsers: [...value.allowedUsers] } }
  ctx.on('loader/volatile-update', () => { void runtime.configure(account()) })
  ctx.effect(() => {
    const controller = new AbortController()
    const starting = (async () => {
      await ctx.get('loader')?.await()
      if (!controller.signal.aborted) await runtime.configure(account())
    })()
    return async () => { controller.abort(); await runtime.dispose(); await starting }
  }, 'feishu-im.lifecycle()')
  ctx.inject(['settings', 'connection'], child => {
    const manager = new SetupManager(child, runtime, account)
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    child.effect(() => {
      runtime.onMessage = (message, account) => manager.receive(message, account)
      const routes = ['status', 'save', 'disconnect', 'pairStart', 'qrStart', 'qrCancel'].map(endpoint => child.connection.fetch.register({
        path: `/api/feishu-im/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
        fetch: async request => {
          let message
          try {
            message = clientRequestSchema.parse(await readJson(new Response(request.body), 32_768))
            if (message.method !== `feishu-im/${endpoint}`) return new Response('invalid method', { status: 400 })
          } catch { return new Response('invalid request', { status: 400 }) }
          let result
          try { result = { ok: true, value: await manager.call(endpoint, message.payload, request.signal) } }
          catch (error: unknown) {
            const code = error instanceof Error && error.message.startsWith('feishu-im: ') ? error.message.slice(11) : 'configuration_failed'
            result = { ok: false, error: { code, message: code, details: {} } }
          }
          return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
        },
      }))
      return async () => { runtime.onMessage = undefined; await Promise.all(routes.map(remove => remove())); await manager.dispose() }
    })
  })
}
