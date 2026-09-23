import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { FeishuPage, apply } from '../src/client.tsx'

const cleanup: Array<() => void> = []
afterEach(() => { for (const close of cleanup.splice(0)) close(); vi.useRealTimers() })
async function harness(zh = true, configured = false, summary = false) {
  vi.useFakeTimers()
  let status = { config: { appId: configured ? 'cli_0123456789abcdef' : '', cwd: '/work', locale: 'zh-CN' as 'zh-CN' | 'en', allowedUsers: [] as string[], apiOrigin: 'https://open.feishu.cn' }, hasSecret: configured, writable: true, revision: 1, state: configured ? 'connected' : 'unconfigured', error: '',
    qr: null as { state: string; image?: string; expiresAt?: number } | null, pairing: null as { code: string; expiresAt: number } | null }
  const call = vi.fn<ClientConnectionRpc['call']>(async (_channel, method, payload) => {
    const data = payload as Record<string, unknown>
    if (method === 'feishu-im/save') status = { ...status, revision: status.revision + 1, hasSecret: true, state: 'connected', config: { ...status.config, appId: String(data.appId), cwd: String(data.cwd), allowedUsers: data.allowedUsers as string[], locale: data.locale as 'zh-CN' | 'en' } }
    if (method === 'feishu-im/pairStart') status = { ...status, pairing: { code: 'one-time', expiresAt: Date.now() + 600000 } }
    if (method === 'feishu-im/qrStart') status = { ...status, qr: { state: 'waiting', image: 'data:image/png;base64,fake', expiresAt: Date.now() + 60000 } }
    if (method === 'feishu-im/qrCancel') status = { ...status, qr: null }
    if (method === 'feishu-im/disconnect') status = { ...status, hasSecret: false, revision: status.revision + 1, state: 'unconfigured', config: { ...status.config, appId: '' } }
    return { ok: true, value: status }
  })
  const snapshot = { active: zh ? 'zh-CN' : 'en' }, locale = { getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as LocaleRuntime
  const props = { rpc: { call } as ClientConnectionRpc, locale, view: summary ? 'summary' as const : 'page' as const }
  let renderer: ReactTestRenderer
  await act(async () => { renderer = create(<FeishuPage {...props} />) })
  cleanup.push(() => act(() => renderer.unmount()))
  const click = async (label: string) => { await act(async () => renderer.root.findAllByType('button').find(button => button.props.children === label)!.props.onClick()) }
  const change = async (type: 'input' | 'textarea' | 'select', index: number, value: string) => { await act(async () => renderer.root.findAllByType(type)[index]!.props.onChange({ target: { value } })) }
  const poll = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(2000) }) }
  return { get renderer() { return renderer }, call, click, change, poll, props, setStatus(patch: Partial<typeof status>) { status = { ...status, ...patch } }, get status() { return status } }
}

it('renders new summary and legacy page slots with the same configuration controls', async () => {
  const h = await harness(true, false, true)
  expect(JSON.stringify(h.renderer.toJSON())).toContain('扫码连接飞书'); expect(h.call).not.toHaveBeenCalled()
  await act(async () => h.renderer.update(<FeishuPage rpc={h.props.rpc} locale={h.props.locale} />)); expect(h.call).toHaveBeenCalled()
  await h.click('使用已有应用')
  expect(h.renderer.root.findByType('form')).toBeDefined()
  const entries: unknown[] = []
  apply({ slots: { inject: (_name: string, register: () => void) => register(), register: (options: { inject: () => unknown }) => { entries.push(options); options.inject() } }, connection: { rpc: h.props.rpc }, locale: h.props.locale } as unknown as Context)
  expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'dsh-feishu-im' }), expect.objectContaining({ key: 'dsh-feishu-im#feishu-im' }), expect.objectContaining({ name: 'settings.plugin.item', key: 'feishu-im' })]))
})

it('keeps secrets blank, submits explicit form values, pairs and disconnects', async () => {
  const h = await harness(true, true)
  expect(h.renderer.root.findAllByType('input')[2]!.props.type).toBe('password')
  expect(h.renderer.root.findAllByType('input')[2]!.props.value).toBe('')
  await h.change('input', 0, '/project'); await h.change('input', 1, 'cli_1111111111111111'); await h.change('input', 2, 'NEW_SECRET')
  await h.change('select', 0, 'lark'); await h.change('select', 1, 'en'); await h.change('textarea', 0, 'ou_one, ou_two')
  await act(async () => h.renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  expect(h.call).toHaveBeenCalledWith('/api', 'feishu-im/save', expect.objectContaining({ appSecret: 'NEW_SECRET', cwd: '/project', allowedUsers: ['ou_one', 'ou_two'], region: 'lark', locale: 'en', revision: 1 }), expect.any(AbortSignal))
  expect(h.renderer.root.findAllByType('input')[2]!.props.value).toBe('')
  await h.click('生成授权配对码'); expect(h.renderer.root.findAllByType('code').some(code => code.children.join('') === '/dsh pair one-time')).toBe(true)
  await h.click('断开并清除凭据'); expect(JSON.stringify(h.renderer.toJSON())).not.toContain('NEW_SECRET')
  await h.click('刷新配置'); expect(h.call.mock.calls.at(-1)?.[1]).toBe('feishu-im/status')
})

it('shows QR status and adopts completed registration without overwriting a dirty form', async () => {
  const h = await harness(false)
  await h.change('input', 0, '/qr-work'); await h.click('Generate QR code')
  expect(h.renderer.root.findByType('img').props.alt).toContain('Scan with Feishu')
  await h.click('Cancel scan'); expect(h.renderer.root.findAllByType('img')).toHaveLength(0)
  await h.click('Generate QR code')
  h.setStatus({ revision: 2, hasSecret: true, state: 'connected', qr: { state: 'complete' }, config: { ...h.status.config, appId: 'cli_new', apiOrigin: 'https://open.larksuite.com', allowedUsers: ['ou_scanner'] } })
  await h.poll(); expect(h.renderer.root.findAllByType('input')[1]!.props.value).toBe('cli_new')
  await h.change('input', 0, '/unsaved'); h.setStatus({ revision: 3, config: { ...h.status.config, cwd: '/external' } }); await h.poll()
  expect(h.renderer.root.findAllByType('input')[0]!.props.value).toBe('/unsaved')
  await h.click('Reload settings'); expect(h.renderer.root.findAllByType('input')[0]!.props.value).toBe('/external')
  await h.click('Create a bot with QR'); expect(JSON.stringify(h.renderer.toJSON())).toContain('Configured')
})

it('shows actionable errors, readonly and connection state while polling remains cancellable', async () => {
  const h = await harness(false, true)
  h.call.mockResolvedValueOnce({ ok: false, error: { code: 'settings_changed', message: '', details: {} } })
  await h.click('Reload settings'); expect(JSON.stringify(h.renderer.toJSON())).toContain('Settings changed')
  h.call.mockRejectedValueOnce(new Error('offline')); await h.click('Reload settings'); expect(JSON.stringify(h.renderer.toJSON())).toContain('Cannot connect')
  h.call.mockResolvedValueOnce({ ok: false, error: { code: 'unknown', message: '', details: {} } }); await h.poll(); expect(JSON.stringify(h.renderer.toJSON())).toContain('Could not save')
  h.call.mockRejectedValueOnce(new Error('offline')); await h.poll()
  h.setStatus({ writable: false, state: 'error', error: 'connection_failed' }); await h.poll()
  expect(h.renderer.root.findByType('fieldset').props.disabled).toBe(true); expect(JSON.stringify(h.renderer.toJSON())).toContain('read-only')
  const pending = Promise.withResolvers<Awaited<ReturnType<ClientConnectionRpc['call']>>>()
  h.call.mockImplementationOnce(() => pending.promise)
  let action: Promise<void>
  act(() => { action = h.renderer.root.findAllByType('button').find(button => button.props.children === 'Reload settings')!.props.onClick() })
  act(() => h.renderer.unmount()); pending.reject(new Error('aborted')); await act(async () => { await action! })
  const count = h.call.mock.calls.length; await vi.advanceTimersByTimeAsync(5000); expect(h.call).toHaveBeenCalledTimes(count)
})

it.each(['resolve', 'reject'] as const)('stops polling when an in-flight status request %s after unmount', async outcome => {
  const h = await harness(false)
  await h.click('Use an existing app')
  const pending = Promise.withResolvers<Awaited<ReturnType<ClientConnectionRpc['call']>>>()
  h.call.mockImplementationOnce(() => pending.promise)
  act(() => { vi.advanceTimersByTime(2000) })
  act(() => h.renderer.unmount())
  await act(async () => {
    if (outcome === 'resolve') pending.resolve({ ok: true, value: h.status })
    else pending.reject(new Error('closed'))
    await Promise.resolve()
  })
  const calls = h.call.mock.calls.length
  await vi.advanceTimersByTimeAsync(5000)
  expect(h.call).toHaveBeenCalledTimes(calls)
})
