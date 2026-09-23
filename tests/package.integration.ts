import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import ts from 'typescript'
import { parseDocument, stringify } from 'yaml'
import { expect, it, vi } from 'vitest'
import { feishuFixture, nativeMessage } from './feishu-fixture.ts'

const execute = promisify(execFile)
const repo = fileURLToPath(new URL('../', import.meta.url))
const dsh = join(dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'))), 'lib/bin.js')

it('installs into dsh Web, configures through authenticated RPC and drives persisted preset tools', async ({ onTestFinished }) => {
  const cleanup: Array<() => Promise<unknown>> = []
  onTestFinished(async () => {
    const errors: unknown[] = []
    for (const close of cleanup.reverse()) { try { await close() } catch (error) { errors.push(error) } }
    if (errors.length) throw new AggregateError(errors, 'Integration cleanup failed')
  })
  const root = await mkdtemp(join(tmpdir(), 'feishu-web-install-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const fixture = await feishuFixture(); cleanup.push(() => fixture.close())
  const cwd = join(root, 'work'); await mkdir(cwd)
  const env = { ...process.env, DSH_HOME: join(root, 'home'), DSH_AGENTS_HOME: join(root, 'agents'), DEEPSEEK_API_KEY: '', CI: 'true' }
  const cli = (...args: string[]) => execute(process.execPath, [dsh, ...args], { cwd, env, timeout: 120_000, maxBuffer: 4_194_304 })
  const packed = await execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], { cwd: repo })
  const { filename, files } = (JSON.parse(packed.stdout) as Array<{ filename: string; files: Array<{ path: string }> }>)[0]!
  expect(files!.some(file => file.path === 'dist/client.cjs')).toBe(true)
  expect(files!.some(file => /^(tests|node_modules|tasks|\.env)/.test(file.path))).toBe(false)
  const profile = join(env.DSH_HOME, 'profiles', 'web')
  await cli('plugin', '--profile', 'web', 'list')
  // This optional protobufjs script only checks dependent version ranges. Verify the SDK works with it explicitly denied.
  const policyPath = join(profile, 'pnpm-workspace.yaml')
  const policy = parseDocument(await readFile(policyPath, 'utf8'))
  expect(policy.get('autoInstallPeers')).toBe(false)
  policy.setIn(['allowBuilds', 'protobufjs'], false)
  await writeFile(policyPath, String(policy))
  await cli('plugin', '--profile', 'web', 'add', join(root, filename!))
  const help = await cli('plugin', '--profile', 'web', 'exec', 'feishu-im', 'setup', '--help')
  expect(help.stdout).toContain('--app-id'); expect(help.stdout).not.toContain('--lark-command')
  const model = join(profile, 'test-model.mjs')
  await writeFile(model, ts.transpileModule(await readFile(new URL('./fixtures/model.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText)
  const patchPath = join(profile, 'cordis.patch.yml')
  await writeFile(patchPath, stringify([
    { id: 'feishu-im', config: { account: { apiOrigin: fixture.origin, cwd, progressIntervalMs: 5 } } },
    { id: 'agent-instructions', disabled: true },
    { id: 'skill-filesystem', config: { includeDefaultRoots: false, watch: false } },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { id: 'session-query-sqlite', config: { path: ':memory:', openAt: 'never' } },
    { id: 'agent-default-model', config: { provider: 'lark-test', model: 'test' } },
    { insert: [{ id: 'test-model', name: model }] },
  ]), { mode: 0o600 })
  let child: ChildProcess | undefined, exited = true, output = '', closed: Promise<void> = Promise.resolve(), origin = '', cookie = ''
  const stop = async () => {
    if (!exited) child?.kill('SIGTERM')
    try { await vi.waitFor(() => expect(exited, output).toBe(true), { timeout: 30_000 }) }
    finally { if (!exited) child?.kill('SIGKILL'); await closed }
  }
  cleanup.push(stop)
  const start = async () => {
    output = ''; exited = false
    child = spawn(process.execPath, [dsh, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() }); child.stderr!.on('data', (chunk: Buffer) => { output += chunk.toString() })
    closed = new Promise<void>((resolve, reject) => { child!.once('error', reject); child!.once('close', () => { exited = true; resolve() }) })
    await vi.waitFor(() => expect(output, output).toContain('dsh web: http'), { timeout: 30_000 })
    const url = /dsh web: (http:\/\/\S+)/.exec(output)![1]!
    origin = new URL(url).origin
    const login = await fetch(url, { redirect: 'manual' })
    cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    expect(cookie).toBeTruthy()
  }
  const rpc = async (endpoint: string, payload: unknown = {}) => {
    const response = await fetch(`${origin}/api/feishu-im/${endpoint}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin },
      body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-rpc', method: `feishu-im/${endpoint}`, payload }), signal: AbortSignal.timeout(5000) }).catch(error => { throw new Error(`${endpoint}: ${String(error)}\n${output}`) })
    const responseText = await response.text()
    expect(response.status, `${responseText}\n${output}`).toBe(200)
    const value = JSON.parse(responseText) as { result: { ok: boolean; value?: any; error?: any } }
    expect(response.status, JSON.stringify(value)).toBe(200)
    return value.result
  }
  const reply = async (id: string, text: string) => vi.waitFor(() => {
    expect(fixture.messages.some(row => row.replyTo === id && JSON.stringify(row.content).includes(text)), `${JSON.stringify(fixture.messages)}\n${output}`).toBe(true)
  }, { timeout: 30_000 })
  await start()
  if (process.env.FEISHU_PREVIEW_FILE) {
    const preview = process.env.FEISHU_PREVIEW_FILE
    const url = /dsh web: (http:\/\/\S+)/.exec(output)![1]!
    await writeFile(preview, JSON.stringify({ url, cwd, apiOrigin: fixture.origin }), { mode: 0o600 })
    cleanup.push(() => rm(preview, { force: true }))
    cleanup.push(() => rm(`${preview}.done`, { force: true }))
    await vi.waitFor(() => access(`${preview}.done`), { timeout: 150_000, interval: 500 })
  }
  const untrusted = await fetch(`${origin}/api/feishu-im/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  expect(untrusted.status, output).toBe(401)
  const initial = await rpc('status'); expect(initial).toMatchObject({ ok: true, value: { state: 'unconfigured', hasSecret: false } })
  const configured = await rpc('save', { revision: initial.value.revision, appId: 'cli_0123456789abcdef', appSecret: 'fixture-only-secret', cwd, allowedUsers: [], locale: 'zh-CN' })
  expect(configured.ok, JSON.stringify(configured)).toBe(true); expect(JSON.stringify(configured)).not.toContain('fixture-only-secret')
  await vi.waitFor(async () => expect((await rpc('status')).value.state).toBe('connected'))
  const pairing = await rpc('pairStart', { revision: configured.value.revision })
  fixture.send(nativeMessage('pair', `/dsh pair ${pairing.value.pairing.code}`))
  await reply('om_pair', '授权成功')
  await vi.waitFor(() => expect(fixture.sockets.size).toBe(1))
  fixture.send(nativeMessage('first', 'write validation file'))
  await reply('om_first', '第 1 条消息')
  expect(await readFile(join(cwd, 'lark-validation.txt'), 'utf8')).toBe('LARK_TOOL_OK\n')
  expect(fixture.messages.some(row => row.type === 'interactive')).toBe(true)
  expect(JSON.stringify(fixture.updates)).toContain('工具')
  const before = fixture.messages.filter(row => row.replyTo === 'om_first').length
  await stop(); await start()
  await vi.waitFor(async () => expect((await rpc('status')).value.state).toBe('connected'))
  fixture.send(nativeMessage('first', 'write validation file')); fixture.send(nativeMessage('second', 'continue conversation'))
  await reply('om_second', '第 2 条消息')
  expect(fixture.messages.filter(row => row.replyTo === 'om_first')).toHaveLength(before)
  const reloaded = await rpc('status')
  expect(reloaded.value.config.allowedUsers).toEqual(['ou_owner'])
  const disconnect = await rpc('disconnect', { revision: reloaded.value.revision }); expect(disconnect.ok).toBe(true)
  await vi.waitFor(() => expect(fixture.sockets.size).toBe(0))
  await stop()
  const paths = await readdir(join(root, 'sessions'), { recursive: true })
  const logPath = paths.find(path => /session\.v\d+\.jsonl$/.test(path))!
  const log = await readFile(join(root, 'sessions', logPath), 'utf8')
  expect(log).toContain('lark:om_second'); expect(log).toContain('tool/result'); expect(log).toContain('agentPreset')
  expect((await readFile(patchPath, 'utf8'))).not.toContain('fixture-only-secret')
})
