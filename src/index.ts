/** Opt-in Feishu private-chat task driver over the existing lark-cli authentication store. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { Config, validateConfig } from './config.ts'
import { LarkDriver } from './driver.ts'
import { LarkCli } from './transport.ts'

export { Config } from './config.ts'

/** Stable plugin name. */
export const name = 'feishu-im'
/** Required task, history, and process services. */
export const inject = ['agents', 'agentDefaultModel', 'sessions', 'sessionPersistence', 'sessionQuery', 'subprocess']

/**
 * Mount a private-chat driver and bind every child and task to the plugin lifetime.
 * @param ctx - composed Harness application context.
 * @param config - validated deployment settings.
 */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('feishu-im: launch through a dsh profile')
  const cli = new LarkCli(ctx, config)
  const driver = new LarkDriver(ctx, config, cli)
  ctx.effect(() => {
    const lifetime = new AbortController()
    const running = (async () => {
      await ctx.get('loader')?.await()
      lifetime.signal.throwIfAborted()
      await ctx.subprocess.resolveExecutable(config.command[0] as string, undefined, lifetime.signal)
      await cli.consume((line) => { driver.receive(line) }, () => {
        process.stderr.write('feishu-im: ready for private messages\n')
      }, lifetime.signal)
    })().catch(async (error: unknown) => {
      if (!lifetime.signal.aborted) {
        process.stderr.write(`feishu-im: ${errorChain(error)}\n`)
        await driver.dispose()
        exit(1)
      }
    })
    return async () => {
      lifetime.abort()
      await driver.dispose()
      await running
    }
  }, 'feishu-im.lifecycle()')
}
