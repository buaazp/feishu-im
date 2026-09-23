import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import ts from 'typescript'
import { parse, stringify } from 'yaml'
import { expect, it, vi } from 'vitest'
import { incoming, larkFixture } from './fixture.ts'

const execute = promisify(execFile)
const repo = fileURLToPath(new URL('../', import.meta.url))
const dsh = join(dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'))), 'lib/bin.js')

it('installs the tarball into a dedicated profile, configures it and drives real persisted tools', async ({ onTestFinished }) => {
  const cleanup: Array<() => Promise<unknown>> = []
  onTestFinished(async () => {
    const errors: unknown[] = []
    for (const close of cleanup.reverse()) {
      try { await close() } catch (error) { errors.push(error) }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Integration cleanup failed')
  })
  const root = await mkdtemp(join(tmpdir(), 'feishu-install-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const fixture = await larkFixture()
  cleanup.push(() => fixture.close())
  const cwd = join(root, 'work'); await mkdir(cwd)
  const env = { ...process.env, DSH_HOME: join(root, 'home'), DSH_AGENTS_HOME: join(root, 'agents'), DEEPSEEK_API_KEY: '', CI: 'true' }
  const cli = async (...args: string[]) => {
    try { return await execute(process.execPath, [dsh, ...args], { cwd, env, timeout: 120_000, maxBuffer: 4_194_304 }) }
    catch (error) { throw new Error(`dsh ${args.join(' ')} failed: ${String(error)}`, { cause: error }) }
  }
  const packed = await execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], { cwd: repo })
  const packages = JSON.parse(packed.stdout) as Array<{ filename: string; files: Array<{ path: string }> }>
  const { filename, files } = packages[0]!
  expect(files!.some(file => file.path === 'dist/index.js')).toBe(true)
  expect(files!.some(file => /^(tests|node_modules|tasks|\.env)/.test(file.path))).toBe(false)
  await cli('plugin', '--profile', 'feishu-test', 'add', join(root, filename!))
  const profile = join(env.DSH_HOME, 'profiles', 'feishu-test')
  const installed: unknown = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  expect(installed).toMatchObject({ dsh: { profile: { bundles: expect.arrayContaining(['dsh-feishu-im']) } } })
  const help = await cli('plugin', '--profile', 'feishu-test', 'exec', 'feishu-im', 'setup', '--help')
  expect(help.stdout).toContain('--allow-user')
  // A test-owned executable implements only public discovery queries. It opens no event connection.
  const discovery = join(root, 'lark-discovery.mjs')
  await writeFile(discovery, `#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.includes('list') ? [{name:'test-app',appId:'cli_test'}] : {identities:{bot:{available:true,verified:true}}}))\n`, { mode: 0o755 })
  await cli('plugin', '--profile', 'feishu-test', 'exec', 'feishu-im', 'setup', '--lark-command', discovery, '--allow-user', 'ou_owner', '--workspace', cwd)
  const doctor = await cli('plugin', '--profile', 'feishu-test', 'exec', 'feishu-im', 'doctor', '--json')
  expect(doctor.stdout).toContain('"ok": true')
  const model = join(profile, 'test-model.mjs')
  await writeFile(model, ts.transpileModule(await readFile(new URL('./fixtures/model.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText)
  const patchPath = join(profile, 'cordis.patch.yml')
  const rows = parse(await readFile(patchPath, 'utf8')) as Array<{ id?: string; config?: Record<string, unknown>; disabled?: boolean; insert?: Array<{ id: string; name: string }> }>
  rows.find(row => row.id === 'headless-runner')!.config!.command = fixture.command
  rows.push(
    { id: 'agent-instructions', disabled: true },
    { id: 'skill-filesystem', config: { includeDefaultRoots: false, watch: false } },
    { id: 'session-title-llm', disabled: true },
    { id: 'settings', disabled: true },
    { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { id: 'session-query-sqlite', config: { path: ':memory:', openAt: 'never' } },
    { id: 'agent-default-model', config: { provider: 'lark-test', model: 'test' } },
    { insert: [{ id: 'test-model', name: model }] },
  )
  await writeFile(patchPath, stringify(rows))
  let child: ChildProcess | undefined
  let exited = true
  let output = ''
  let closed: Promise<void> = Promise.resolve()
  const stop = async () => {
    if (!exited) child?.kill('SIGTERM')
    try { await vi.waitFor(() => { expect(exited, output).toBe(true) }, { timeout: 30_000 }) }
    finally { if (!exited) child?.kill('SIGKILL'); await closed }
  }
  cleanup.push(stop)
  const start = async () => {
    output = ''; exited = false
    child = spawn(process.execPath, [dsh, '--profile', 'feishu-test'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr!.on('data', (chunk: Buffer) => { output += chunk.toString() })
    closed = new Promise<void>((resolve, reject) => { child!.once('error', reject); child!.once('close', () => { exited = true; resolve() }) })
    await vi.waitFor(() => { expect(output, `exited=${exited}\n${output}`).toContain('feishu-im: ready for private messages') }, { timeout: 30_000 })
  }
  const reply = async (id: string, text: string) => vi.waitFor(() => {
    expect(fixture.replies.some(row => row.messageId === id && row.text.includes(text)), `${JSON.stringify(fixture.replies)}\n${output}`).toBe(true)
  }, { timeout: 30_000 })
  await start()
  fixture.send(incoming('first', 'write validation file'))
  await reply('om_first', '第 1 条消息')
  expect(await readFile(join(cwd, 'lark-validation.txt'), 'utf8')).toBe('LARK_TOOL_OK\n')
  expect(fixture.replies.filter(row => row.messageId === 'om_first').map(row => row.text).join('\n\n') + '\n')
    .toBe(await readFile(new URL('./expected/private-chat.txt', import.meta.url), 'utf8'))
  await stop()
  await start()
  fixture.send(incoming('first', 'write validation file'))
  fixture.send(incoming('second', 'continue conversation'))
  await reply('om_second', '第 2 条消息')
  expect(fixture.replies.filter(row => row.messageId === 'om_first')).toHaveLength(2)
  await stop()
  const paths = await readdir(join(root, 'sessions'), { recursive: true })
  const logPath = paths.find(path => /session\.v\d+\.jsonl$/.test(path))
  expect(logPath).toBeDefined()
  const log = await readFile(join(root, 'sessions', logPath!), 'utf8')
  expect(log).toContain('lark:om_second')
  expect(log).toContain('tool/result')
  await cli('plugin', '--profile', 'feishu-test', 'exec', 'feishu-im', 'reset')
  expect(await readFile(patchPath, 'utf8')).not.toContain('headless-runner')
  expect(await readFile(patchPath, 'utf8')).toContain('agent-default-model')
  await expect(cli('--profile', 'feishu-test')).rejects.toThrow('setup')
})
