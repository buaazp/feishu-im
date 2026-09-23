import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createManagementProgram, diagnose, type ManagementEnvironment } from '../src/management.ts'
import { readConfiguration, writeConfiguration } from '../src/profile.ts'

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof fs>() }))
let root: string
let directory: string
let work: string
let environment: ManagementEnvironment
let output: string
const profiles = [{ name: 'app', appId: 'cli_test' }]
const bot = { identities: { bot: { available: true, verified: true }, user: { openId: 'ou_owner' } } }
const query = vi.fn<ManagementEnvironment['query']>()
const ask = vi.fn<ManagementEnvironment['ask']>()
const exitCode = vi.fn<ManagementEnvironment['exitCode']>()
const run = (...args: string[]) => createManagementProgram(environment).parseAsync(args, { from: 'user' })
const configure = async () => writeConfiguration(directory, { profile: 'app', allowedUsers: ['ou_owner'], cwd: work })
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'feishu-management-'))
  directory = join(root, 'profile'); work = join(root, 'work')
  await fs.mkdir(directory); await fs.mkdir(work)
  await fs.writeFile(join(directory, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-feishu-im'] } } }))
  output = ''
  query.mockReset().mockImplementation(async (_command, args) => args[0] === 'profile' ? profiles : bot)
  ask.mockReset(); exitCode.mockReset()
  environment = { directory, version: '0.1.0', interactive: false, query, ask, exitCode, write: value => { output += value }, writeError: value => { output += value } }
})
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) })

describe('setup and doctor', () => {
  it('configures a single app explicitly, deduplicates senders and preserves defaults', async () => {
    await run('setup', '--allow-user', 'ou_owner, ou_second', '--allow-user', 'ou_owner', '--workspace', work, '--locale', 'en', '--lark-command', '/custom/lark')
    expect(await readConfiguration(directory)).toMatchObject({ profile: 'app', allowedUsers: ['ou_owner', 'ou_second'], cwd: work, locale: 'en', command: ['/custom/lark'] })
    expect(query).toHaveBeenNthCalledWith(2, ['/custom/lark'], ['--profile', 'app', 'auth', 'status', '--json', '--verify'])
    expect(output).toContain('2 authorized user(s)')
    expect(ask).not.toHaveBeenCalled()
    await run('doctor', '--json')
    expect(exitCode).toHaveBeenLastCalledWith(0)
    expect(output).toContain('"ok": true')
    await run('reset')
    await expect(readConfiguration(directory)).rejects.toThrow('not configured')
  })

  it('prompts for app, explicit allowlist and workspace in interactive terminals', async () => {
    environment.interactive = true
    query.mockResolvedValueOnce([...profiles, { name: 'second', appId: 'cli_second' }]).mockResolvedValueOnce(bot)
    ask.mockResolvedValueOnce('2').mockResolvedValueOnce('ou_owner, ,ou_second').mockResolvedValueOnce(work)
    await run('setup')
    expect(ask).toHaveBeenNthCalledWith(2, 'Allowed human open_ids, separated by commas', 'ou_owner')
    expect(await readConfiguration(directory)).toMatchObject({ profile: 'second', allowedUsers: ['ou_owner', 'ou_second'], locale: 'zh-CN' })
    expect(output).toContain('2. second (cli_second)')
    await run('doctor')
    expect(output).toContain('OK bot')
    expect(output).toContain('does not start a model or open an event connection')
  })

  it('requires a selected application and verified bot', async () => {
    query.mockResolvedValueOnce([])
    await expect(run('setup')).rejects.toThrow('config init')
    query.mockResolvedValueOnce([...profiles, { name: 'second', appId: 'cli_second' }])
    await expect(run('setup')).rejects.toThrow('--lark-profile')
    await expect(run('setup', '--lark-profile', 'missing')).rejects.toThrow('does not exist')
    environment.interactive = true
    query.mockResolvedValueOnce([...profiles, { name: 'second', appId: 'cli_second' }]); ask.mockResolvedValueOnce('bad')
    await expect(run('setup')).rejects.toThrow('does not exist')
    query.mockResolvedValueOnce(profiles).mockResolvedValueOnce({})
    await expect(run('setup', '--lark-profile', 'app')).rejects.toThrow('Bot identity is unavailable')
  })

  it('never admits a suggested identity implicitly or chooses the profile as the workspace', async () => {
    await expect(run('setup')).rejects.toThrow('--allow-user')
    await expect(run('setup', '--allow-user', 'ou_owner')).rejects.toThrow('--workspace')
    await expect(run('setup', '--allow-user', 'ou_owner', '--workspace', ' ')).rejects.toThrow('--workspace')
    await expect(run('setup', '--allow-user', 'ou_owner', '--workspace', '.')).rejects.toThrow('outside the dsh profile')
    await expect(run('setup', '--allow-user', 'ou_owner', '--workspace', join(directory, 'nested-work'))).rejects.toThrow('outside the dsh profile')
    await fs.writeFile(join(root, 'file'), 'not a directory')
    await expect(run('setup', '--allow-user', 'ou_owner', '--workspace', join(root, 'file'))).rejects.toThrow('not a directory')
    await expect(run('setup', '--allow-user', 'ou_owner', '--workspace', work, '--locale', 'de')).rejects.toThrow('--locale')
    await expect(run('setup', '--allow-user', 'everyone', '--workspace', work)).rejects.toThrow('open_ids')
  })

  it('fails doctor early for bad config and returns a nonzero machine-readable result', async () => {
    await run('doctor', '--json')
    expect(JSON.parse(output)).toMatchObject({ ok: false, checks: [{ name: 'configuration', status: 'fail' }] })
    expect(exitCode).toHaveBeenCalledWith(1)
    expect(query).not.toHaveBeenCalled()
    await configure()
    vi.spyOn(fs, 'lstat').mockRejectedValueOnce('storage unavailable')
    expect(await diagnose(environment)).toEqual([{ name: 'configuration', status: 'fail', detail: 'storage unavailable' }])
  })

  it('reports workspace and authentication failures independently', async () => {
    await configure()
    await fs.rm(work, { recursive: true })
    query.mockResolvedValueOnce({})
    await run('doctor')
    expect(output).toContain('FAIL workspace')
    expect(output).toContain('FAIL bot')
    expect(exitCode).toHaveBeenCalledWith(1)
    vi.spyOn(fs, 'stat').mockRejectedValueOnce('permission denied')
    query.mockRejectedValueOnce(new Error('bot query failed'))
    expect(await diagnose(environment)).toMatchObject([{ status: 'pass' }, { detail: 'Cannot read and write the task directory: permission denied' }, { detail: 'bot query failed' }])
    query.mockRejectedValueOnce('offline')
    expect((await diagnose(environment)).at(-1)?.detail).toBe('offline')
  })

  it('exposes version and actionable subcommand help without querying Feishu', async () => {
    await expect(run('--version')).rejects.toMatchObject({ exitCode: 0 })
    expect(output).toContain('0.1.0')
    await expect(run('setup', '--help')).rejects.toMatchObject({ exitCode: 0 })
    expect(output).toContain('--allow-user')
    await expect(run('--unknown')).rejects.toMatchObject({ exitCode: 1 })
    expect(query).not.toHaveBeenCalled()
  })
})
