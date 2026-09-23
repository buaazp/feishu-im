/** Direct-API configuration and diagnostics; never starts an Agent. */
import { resolve } from 'node:path'
import { Command } from 'commander'
import { Config, validateConfig } from './config.ts'
import { FeishuApi } from './feishu-api.ts'
import { assertProfile, readConfiguration, resetConfiguration, writeConfiguration } from './profile.ts'
import { checkWorkspace } from './setup-manager.ts'

export interface ManagementEnvironment {
  directory: string
  version: string
  readSecret(): Promise<string>
  write(text: string): void
  writeError(text: string): void
  exitCode(code: number): void
  probe?(config: Config): Promise<void>
}

async function probe(environment: ManagementEnvironment, config: Config): Promise<void> {
  if (environment.probe) return environment.probe(config)
  const api = new FeishuApi(config)
  try { await api.probe(AbortSignal.timeout(config.requestTimeoutMs)) } finally { await api.close() }
}

export interface Diagnostic { name: string; status: 'pass' | 'fail'; detail: string }
export async function diagnose(environment: ManagementEnvironment): Promise<Diagnostic[]> {
  const checks: Diagnostic[] = []
  let config: Config
  try {
    config = await readConfiguration(environment.directory)
    checks.push({ name: 'configuration', status: 'pass', detail: `${config.appId}; ${config.allowedUsers.length} authorized user(s)` })
  } catch { return [{ name: 'configuration', status: 'fail', detail: 'Configure Feishu IM on the dsh Plugins page first.' }] }
  try { await checkWorkspace(config.cwd, environment.directory); checks.push({ name: 'workspace', status: 'pass', detail: config.cwd }) }
  catch { checks.push({ name: 'workspace', status: 'fail', detail: 'Choose a readable, writable task directory outside the profile.' }) }
  try { await probe(environment, config); checks.push({ name: 'bot', status: 'pass', detail: 'Bot credentials verified directly with Feishu.' }) }
  catch { checks.push({ name: 'bot', status: 'fail', detail: 'Check App ID, App Secret and the bot capability.' }) }
  return checks
}

export function createManagementProgram(environment: ManagementEnvironment): Command {
  const program = new Command().name('feishu-im').description('Configure the direct Feishu channel. For QR setup, open Feishu IM on the dsh Plugins page.').version(environment.version)
  program.exitOverride().configureOutput({ writeOut: environment.write, writeErr: environment.writeError })
  program.command('setup').description('Save App ID and an App Secret read from standard input; restart dsh afterward.')
    .requiredOption('--app-id <id>', 'Feishu application App ID')
    .requiredOption('--secret-stdin', 'Read App Secret from standard input')
    .requiredOption('--workspace <path>', 'Task workspace outside the profile directory')
    .option('--allow-user <open_id>', 'Allowed human open_id; repeat or separate with commas', (value: string, previous: string[] = []) => [...previous, ...value.split(',').map(id => id.trim()).filter(Boolean)])
    .option('--locale <locale>', 'zh-CN or en', 'zh-CN')
    .option('--lark', 'Use the international Lark API')
    .option('--legacy-namespace <name>', 'Explicit old profile name for continuing pre-0.2 sessions')
    .action(async (options: { appId: string; workspace: string; allowUser?: string[]; locale: string; lark?: boolean; legacyNamespace?: string }) => {
      await assertProfile(environment.directory)
      const config = Config({ appId: options.appId, appSecret: (await environment.readSecret()).trim(), cwd: resolve(environment.directory, options.workspace),
        allowedUsers: [...new Set(options.allowUser ?? [])], locale: options.locale as Config['locale'],
        apiOrigin: options.lark ? 'https://open.larksuite.com' : 'https://open.feishu.cn', legacyNamespace: options.legacyNamespace })
      validateConfig(config); await checkWorkspace(config.cwd, environment.directory)
      await probe(environment, config)
      await writeConfiguration(environment.directory, config)
      environment.write(`Configured ${config.appId}. Restart dsh. Authorize users on the Feishu IM page before sending tasks.\n`)
    })
  program.command('doctor').description('Check configuration, workspace and bot credentials; sends no messages.')
    .option('--json', 'Print a machine-readable report')
    .action(async (options: { json?: boolean }) => {
      const checks = await diagnose(environment), ok = checks.every(check => check.status === 'pass')
      environment.write(options.json ? JSON.stringify({ ok, checks }, null, 2) + '\n' : checks.map(check => `${check.status === 'pass' ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`).join('\n') + '\n')
      environment.exitCode(ok ? 0 : 1)
    })
  program.command('reset').description('Remove the plugin configuration; preserve Session history.')
    .action(async () => { await resetConfiguration(environment.directory); environment.write('Removed Feishu IM configuration. Restart dsh.\n') })
  return program
}
