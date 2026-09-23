/** Reconfiguration cancels and joins the previous account before activating its replacement. */
import { AsyncResource } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { Config, validateConfig } from './config.ts'
import { FeishuApi } from './feishu-api.ts'
import { FeishuEvents, type ConnectionState } from './feishu-events.ts'
import { FeishuDriver } from './driver.ts'
import type { IncomingMessage } from './protocol.ts'

export class FeishuRuntime {
  state: ConnectionState = 'unconfigured'
  error = ''
  onMessage?: (message: IncomingMessage, config: Config) => boolean
  private current?: { controller: AbortController; done: Promise<void> }
  // Socket callbacks must not inherit the transient HMR transaction that committed a live edit.
  private readonly scope = new AsyncResource('feishu-im-channel')
  private revision = 0
  private closed = false
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly ctx: Context) {}

  configure(config: Config): Promise<void> {
    const revision = ++this.revision
    this.current?.controller.abort()
    this.chain = this.scope.runInAsyncScope(() => this.chain.then(async () => {
      await this.current?.done
      if (this.closed || revision !== this.revision) return
      this.error = ''
      if (!config.appId && !config.appSecret) { this.state = 'unconfigured'; return }
      try { validateConfig(config) } catch { this.state = 'error'; this.error = 'invalid_configuration'; return }
      const controller = new AbortController()
      const api = new FeishuApi(config)
      const driver = new FeishuDriver(this.ctx, config, api)
      const done = new FeishuEvents(api, config.startupTimeoutMs).consume(message => {
        if (!this.onMessage?.(message, config)) driver.receive(message)
      }, event => driver.receiveAction(event), state => { this.state = state }, controller.signal)
        .catch(() => {
          if (!controller.signal.aborted) { this.error = 'connection_failed'; process.stderr.write('feishu-im: connection failed; check settings\n') }
        }).finally(async () => {
          controller.abort()
          await driver.dispose()
          await api.close()
          if (this.error) this.state = 'error'
        })
      this.current = { controller, done }
    }))
    return this.chain
  }

  async dispose(): Promise<void> {
    this.closed = true; this.revision++
    this.current?.controller.abort()
    await this.chain
    await this.current?.done
    this.onMessage = undefined
    this.scope.emitDestroy()
    this.state = 'stopped'
  }
}
