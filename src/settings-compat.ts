/** Published SettingsProvider (pre-0.1.7) and Config-derived SettingsForms share one account view. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Config, type LiveConfig } from './config.ts'

interface AccountScope {
  get(): { account: Config }
  watch(callback: () => Promise<void>): () => void
}
/** Only the public namespace API used before SettingsForms replaced it. */
interface NamespaceSettings {
  register(ns: string, schema: z, options: { base: { account: Config } }): AccountScope
}

export function readAccount(config: LiveConfig): Config {
  const value = 'get' in config.account ? config.account.get() : config.account
  return { ...value, allowedUsers: [...value.allowedUsers] }
}

export function bindSettings(ctx: Context, owner: Context, config: LiveConfig,
  changed: (account: Config) => Promise<void>): () => Config {
  if (typeof ctx.settings.configure === 'function') {
    ctx.effect(() => ctx.settings.configure({ auto: false }, owner.fiber))
    return () => readAccount(config)
  }
  // The old public provider stores namespace values in settings.yaml and owns their revisions.
  const settings = ctx.settings as unknown as NamespaceSettings
  const scope = settings.register('feishu-im', z.object({ account: Config }), { base: { account: readAccount(config) } })
  ctx.effect(() => scope.watch(() => changed(readAccount(scope.get()))))
  return () => readAccount(scope.get())
}
