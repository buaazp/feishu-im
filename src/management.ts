/** Setup and diagnostics for an installed profile; these commands do not launch Agents. */
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { Command } from 'commander'
import { parseIdentity, parseProfiles } from './lark-auth.ts'
import { assertProfile, readConfiguration, resetConfiguration, writeConfiguration } from './profile.ts'
import type { Locale } from './messages.ts'

/** Explicit process I/O, shared by the executable and isolated management tests. */
export interface ManagementEnvironment {
  directory: string
  version: string
  interactive: boolean
  query(command: readonly string[], args: readonly string[]): Promise<unknown>
  ask(question: string, suggestion?: string): Promise<string>
  write(text: string): void
  writeError(text: string): void
  exitCode(code: number): void
}

interface SetupOptions {
  larkProfile?: string
  allowUser?: string[]
  workspace?: string
  locale: string
  larkCommand: string
}

async function workspace(path: string): Promise<void> {
  if (!(await stat(path)).isDirectory()) throw new Error(`Workspace is not a directory: ${path}`)
  await access(path, constants.R_OK | constants.W_OK)
}

async function setup(environment: ManagementEnvironment, options: SetupOptions): Promise<void> {
  await assertProfile(environment.directory)
  const command = [options.larkCommand]
  const profiles = parseProfiles(await environment.query(command, ['profile', 'list']))
  if (profiles.length === 0) throw new Error('No lark-cli application is configured. Run lark-cli config init first.')
  let selected = options.larkProfile
  if (selected === undefined && profiles.length === 1) selected = profiles[0]!.name
  if (selected === undefined) {
    if (!environment.interactive) throw new Error('More than one application is configured. Specify --lark-profile NAME.')
    environment.write(profiles.map((profile, index) => `${index + 1}. ${profile.name} (${profile.appId})`).join('\n') + '\n')
    const answer = await environment.ask('Choose an application number')
    selected = profiles[Number(answer) - 1]?.name
  }
  if (selected === undefined || !profiles.some(profile => profile.name === selected)) {
    throw new Error('The selected lark-cli profile does not exist. Run lark-cli profile list.')
  }
  const identity = parseIdentity(await environment.query(command, ['--profile', selected, 'auth', 'status', '--json', '--verify']))
  if (!identity.botReady) throw new Error('Bot identity is unavailable. Check the application credentials and bot capability in lark-cli; user OAuth login is not required.')
  let allowedUsers = options.allowUser
  if (allowedUsers === undefined) {
    if (!environment.interactive) throw new Error('Specify --allow-user ou_OPEN_ID explicitly in noninteractive setup.')
    const answer = await environment.ask('Allowed human open_ids, separated by commas', identity.userId)
    allowedUsers = answer.split(',').map(value => value.trim()).filter(Boolean)
  }
  let directory = options.workspace
  if (directory === undefined && environment.interactive) directory = await environment.ask('Absolute task workspace directory')
  if (directory === undefined || directory.trim() === '') throw new Error('Specify --workspace /absolute/task/directory.')
  directory = resolve(environment.directory, directory)
  const fromProfile = relative(environment.directory, directory)
  if (fromProfile === '' || (!isAbsolute(fromProfile) && fromProfile !== '..' && !fromProfile.startsWith(`..${sep}`))) {
    throw new Error('Choose a task workspace outside the dsh profile directory.')
  }
  await workspace(directory)
  if (options.locale !== 'zh-CN' && options.locale !== 'en') throw new Error('--locale must be zh-CN or en.')
  allowedUsers = [...new Set(allowedUsers)]
  await writeConfiguration(environment.directory, {
    profile: selected, allowedUsers, cwd: directory,
    locale: options.locale, command,
  })
  environment.write(`Configured ${selected} for ${allowedUsers.length} authorized user(s).\nWorkspace: ${directory}\nSaved cordis.patch.yml. Run doctor, then change to the workspace above and launch this dsh profile.\n`)
}

/** A check reports evidence without printing raw CLI authentication data. */
export interface Diagnostic {
  name: string
  status: 'pass' | 'fail'
  detail: string
}

/** Inspect local configuration, workspace access, and the configured bot identity. */
export async function diagnose(environment: ManagementEnvironment): Promise<Diagnostic[]> {
  const checks: Diagnostic[] = []
  let config
  try {
    config = await readConfiguration(environment.directory)
    checks.push({ name: 'configuration', status: 'pass', detail: `${config.allowedUsers.length} authorized user(s); locale ${config.locale}` })
  } catch (error: unknown) {
    checks.push({ name: 'configuration', status: 'fail', detail: error instanceof Error ? error.message : String(error) })
    return checks
  }
  try {
    await workspace(config.cwd)
    checks.push({ name: 'workspace', status: 'pass', detail: config.cwd })
  } catch (error: unknown) {
    checks.push({ name: 'workspace', status: 'fail', detail: `Cannot read and write the task directory: ${error instanceof Error ? error.message : String(error)}` })
  }
  try {
    const identity = parseIdentity(await environment.query(config.command, ['--profile', config.profile, 'auth', 'status', '--json', '--verify']))
    checks.push({ name: 'bot', status: identity.botReady ? 'pass' : 'fail', detail: identity.botReady
      ? `Bot identity verified for ${config.profile}. User OAuth is not needed.`
      : 'Bot identity is unavailable. Check lark-cli configuration and the application bot capability.' })
  } catch (error: unknown) {
    checks.push({ name: 'bot', status: 'fail', detail: error instanceof Error ? error.message : String(error) })
  }
  return checks
}

function addUser(value: string, previous: string[] = []): string[] {
  return [...previous, ...value.split(',').map(user => user.trim()).filter(Boolean)]
}

/** Build management commands with caller-owned I/O and working directory. */
export function createManagementProgram(environment: ManagementEnvironment): Command {
  const program = new Command().name('feishu-im').description('Configure and diagnose a Feishu IM dsh profile.').version(environment.version)
  program.exitOverride().configureOutput({ writeOut: environment.write, writeErr: environment.writeError })
  program.command('setup').description('Configure the installed bundle without copying credentials.')
    .option('--lark-profile <name>', 'Existing lark-cli application profile; inferred only when there is one')
    .option('--allow-user <open_id>', 'Allowed human open_id; repeat or separate with commas', addUser)
    .option('--workspace <path>', 'Existing task directory')
    .option('--locale <locale>', 'Control message language: zh-CN or en', 'zh-CN' satisfies Locale)
    .option('--lark-command <path>', 'Path to the lark-cli executable', 'lark-cli')
    .action(async (options: SetupOptions) => { await setup(environment, options) })
  program.command('doctor').description('Check configuration, workspace, and bot authentication; sends no messages.')
    .option('--json', 'Print a machine-readable report')
    .action(async (options: { json?: boolean }) => {
      const checks = await diagnose(environment)
      const ok = checks.every(check => check.status === 'pass')
      environment.write(options.json ? JSON.stringify({ ok, checks }, null, 2) + '\n'
        : checks.map(check => `${check.status === 'pass' ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`).join('\n')
          + '\nDoctor does not start a model or open an event connection. Launch dsh to verify event subscription and send a first task.\n')
      environment.exitCode(ok ? 0 : 1)
    })
  program.command('reset').description('Remove this plugin’s configuration row; keep other settings and Session history.')
    .action(async () => {
      await resetConfiguration(environment.directory)
      environment.write('Removed the feishu-im configuration row. Session history is unchanged.\n')
    })
  return program
}
