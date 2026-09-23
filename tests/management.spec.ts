import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createManagementProgram, diagnose, type ManagementEnvironment } from '../src/management.ts'
import { readConfiguration, writeConfiguration } from '../src/profile.ts'
import { feishuFixture } from './feishu-fixture.ts'

let root: string, directory: string, work: string, environment: ManagementEnvironment, output: string
const probe = vi.fn<NonNullable<ManagementEnvironment['probe']>>()
const exitCode = vi.fn()
const run = (...args: string[]) => createManagementProgram(environment).parseAsync(args, { from: 'user' })
const appId = 'cli_0123456789abcdef'
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'feishu-management-')); directory = join(root, 'profile'); work = join(root, 'work')
  await mkdir(directory); await mkdir(work)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-feishu-im', '@deepseek-ai/dsh-web-app'] } } }))
  output = ''; probe.mockReset().mockResolvedValue(); exitCode.mockReset()
  environment = { directory, version: '0.2.0', readSecret: async () => 'fake-secret\n', probe, exitCode,
    write: value => { output += value }, writeError: value => { output += value } }
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it('configures native credentials, explicit users and a workspace without a CLI dependency', async () => {
  await run('setup', '--app-id', appId, '--secret-stdin', '--workspace', work, '--allow-user', 'ou_owner, ,ou_second', '--allow-user', 'ou_owner', '--locale', 'en')
  expect(await readConfiguration(directory)).toMatchObject({ appId, appSecret: 'fake-secret', cwd: work, allowedUsers: ['ou_owner', 'ou_second'], locale: 'en' })
  expect(output).not.toContain('fake-secret')
  expect(await readFile(join(directory, 'cordis.patch.yml'), 'utf8')).not.toContain('lark-cli')
  await run('doctor', '--json'); expect(exitCode).toHaveBeenLastCalledWith(0); expect(output).toContain('"ok": true')
  await run('reset'); await expect(readConfiguration(directory)).rejects.toThrow('not configured')
})
it('supports Lark and leaves an omitted allowlist closed until explicit pairing', async () => {
  await run('setup', '--app-id', appId, '--secret-stdin', '--workspace', work, '--lark', '--legacy-namespace', 'old-profile')
  expect(await readConfiguration(directory)).toMatchObject({ apiOrigin: 'https://open.larksuite.com', allowedUsers: [], legacyNamespace: 'old-profile', locale: 'zh-CN' })
  await run('doctor'); expect(output).toContain('OK bot')
})
it('refuses missing credentials, invalid users and unsafe workspaces', async () => {
  await expect(run('setup')).rejects.toThrow('--app-id')
  for (const cwd of [directory, join(directory, 'nested'), join(root, 'missing')]) {
    await expect(run('setup', '--app-id', appId, '--secret-stdin', '--workspace', cwd)).rejects.toThrow('workspace')
  }
  await expect(run('setup', '--app-id', appId, '--secret-stdin', '--workspace', work, '--allow-user', 'everyone')).rejects.toThrow('open_ids')
  probe.mockRejectedValueOnce(new Error('offline'))
  await expect(run('setup', '--app-id', appId, '--secret-stdin', '--workspace', work)).rejects.toThrow('offline')
})
it('diagnoses invalid configuration early and independent workspace and bot failures', async () => {
  await run('doctor', '--json'); expect(JSON.parse(output).ok).toBe(false); expect(exitCode).toHaveBeenLastCalledWith(1); expect(probe).not.toHaveBeenCalled()
  await run('doctor'); expect(output).toContain('FAIL')
  await writeConfiguration(directory, { appId, appSecret: 'fake', cwd: work })
  await rm(work, { recursive: true }); probe.mockRejectedValue(new Error('secret-bearing network error'))
  const checks = await diagnose(environment)
  expect(checks.map(check => check.status)).toEqual(['pass', 'fail', 'fail']); expect(JSON.stringify(checks)).not.toContain('secret-bearing')
})
it('uses direct HTTP for doctor when no test probe is injected', async () => {
  const fixture = await feishuFixture()
  try {
    await writeConfiguration(directory, { appId, appSecret: 'fake', cwd: work, apiOrigin: fixture.origin })
    delete environment.probe
    expect((await diagnose(environment)).at(-1)?.status).toBe('pass')
    expect(fixture.messages).toHaveLength(0)
  } finally { await fixture.close() }
})
it('exposes useful help and version without contacting Feishu', async () => {
  await expect(run('--version')).rejects.toMatchObject({ exitCode: 0 }); expect(output).toContain('0.2.0')
  await expect(run('setup', '--help')).rejects.toMatchObject({ exitCode: 0 }); expect(output).toContain('--secret-stdin')
  await expect(run('--unknown')).rejects.toMatchObject({ exitCode: 1 }); expect(probe).not.toHaveBeenCalled()
})
