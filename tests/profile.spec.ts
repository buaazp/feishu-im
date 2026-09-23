import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertProfile, readConfiguration, resetConfiguration, writeConfiguration } from '../src/profile.ts'

// Partial module mock keeps real filesystem semantics while allowing owned fault injection.
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof fs>() }))

let root: string
const settings = { appId: 'cli_0123456789abcdef', appSecret: 'fake-secret', cwd: '/tmp/work', allowedUsers: ['ou_owner'] }
const manifest = { dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-feishu-im'] } } }
const patch = () => join(root, 'cordis.patch.yml')
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'feishu-profile-'))
  await fs.writeFile(join(root, 'package.json'), JSON.stringify(manifest))
})
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) })

describe('profile configuration ownership', () => {
  it('creates, updates and resets only its row, preserving comments and js expressions', async () => {
    await fs.writeFile(patch(), '# personal overrides\n- id: agent-default-model\n  config: !!js process.env.MY_MODEL\n')
    await writeConfiguration(root, { ...settings, taskTimeoutMs: 1234 })
    await writeConfiguration(root, { locale: 'en' })
    expect(await readConfiguration(root)).toMatchObject({ ...settings, locale: 'en', taskTimeoutMs: 1234 })
    const source = await fs.readFile(patch(), 'utf8')
    expect(source).toContain('# personal overrides')
    expect(source).toContain('!!js process.env.MY_MODEL')
    if (process.platform !== 'win32') expect((await fs.stat(patch())).mode & 0o777).toBe(0o600)
    await resetConfiguration(root)
    expect(await fs.readFile(patch(), 'utf8')).not.toContain('feishu-im')
    expect(await fs.readFile(patch(), 'utf8')).toContain('MY_MODEL')
    await resetConfiguration(root)
  })

  it('creates a missing patch and adopts a config-only override', async () => {
    await writeConfiguration(root, settings)
    expect(await readConfiguration(root)).toMatchObject(settings)
    await fs.writeFile(patch(), '- id: feishu-im\n  config:\n    account:\n      maxPendingMessages: 3\n')
    await writeConfiguration(root, settings)
    expect((await readConfiguration(root)).maxPendingMessages).toBe(3)
    await fs.writeFile(patch(), '- id: feishu-im\n')
    await expect(resetConfiguration(root)).rejects.toThrow('not owned')
    await writeConfiguration(root, settings)
    expect((await readConfiguration(root)).appId).toBe('cli_0123456789abcdef')
  })

  it('rejects directories that are not dedicated installed profiles', async () => {
    for (const value of [null, [], {}, { dsh: null }, { dsh: {} }, { dsh: { profile: {} } }, { dsh: { profile: { bundles: [] } } }]) {
      await fs.writeFile(join(root, 'package.json'), JSON.stringify(value))
      await expect(assertProfile(root)).rejects.toThrow()
    }
    await fs.writeFile(join(root, 'package.json'), '{')
    await expect(assertProfile(root)).rejects.toThrow('Run through dsh plugin')
  })

  it('rejects malformed or foreign overrides without changing their bytes', async () => {
    for (const source of ['{', '{}', '- id: feishu-im\n- id: feishu-im\n', '- id: feishu-im\n  name: another-plugin\n', '- id: feishu-im\n  config: scalar\n', '- id: feishu-im\n  config:\n    account: scalar\n']) {
      await fs.writeFile(patch(), source)
      await expect(writeConfiguration(root, settings)).rejects.toThrow()
      expect(await fs.readFile(patch(), 'utf8')).toBe(source)
      expect(await fs.readdir(root)).toEqual(expect.not.arrayContaining(['.feishu-im-setup.lock']))
    }
  })

  it('diagnoses unconfigured, disabled and invalid runner settings', async () => {
    await expect(readConfiguration(root)).rejects.toThrow('not configured')
    await fs.writeFile(patch(), '- id: feishu-im\n  disabled: true\n')
    await expect(readConfiguration(root)).rejects.toThrow('disabled')
    await fs.writeFile(patch(), '- id: feishu-im\n')
    await expect(readConfiguration(root)).rejects.toThrow('mapping')
    await fs.writeFile(patch(), '- id: feishu-im\n  config: {}\n')
    await expect(readConfiguration(root)).rejects.toThrow('App ID')
  })

  it('refuses symlinks and propagates filesystem failures', async () => {
    await fs.writeFile(join(root, 'target'), '[]\n')
    await fs.symlink(join(root, 'target'), patch())
    await expect(writeConfiguration(root, settings)).rejects.toThrow('symlink')
    await fs.unlink(patch())
    vi.spyOn(fs, 'lstat').mockRejectedValueOnce(new Error('permission denied'))
    await expect(readConfiguration(root)).rejects.toThrow('permission denied')
    vi.spyOn(fs, 'lstat').mockRejectedValueOnce('filesystem unavailable')
    await expect(readConfiguration(root)).rejects.toBe('filesystem unavailable')
  })

  it('serializes setup writers and releases its lock on failed writes', async () => {
    await fs.mkdir(join(root, '.feishu-im-setup.lock'))
    await expect(writeConfiguration(root, settings)).rejects.toThrow('Another configuration command')
    await fs.rm(join(root, '.feishu-im-setup.lock'), { recursive: true })
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'))
    await expect(writeConfiguration(root, settings)).rejects.toThrow('disk full')
    await writeConfiguration(root, settings)
    expect((await readConfiguration(root)).appId).toBe('cli_0123456789abcdef')
  })

  it('detects an intervening edit instead of replacing it', async () => {
    const actualWrite = fs.writeFile
    vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
      await actualWrite(...args)
      await actualWrite(patch(), '# external edit\n[]\n')
    })
    await expect(writeConfiguration(root, settings)).rejects.toThrow('changed during setup')
    expect(await fs.readFile(patch(), 'utf8')).toBe('# external edit\n[]\n')
  })
})
