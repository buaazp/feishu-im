import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerFeishuApp } from '../src/registration.ts'

const begin = { device_code: 'device', verification_uri_complete: 'https://accounts.feishu.cn/verify?code=x', expires_in: 60, interval: 0 }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('cancellable native app registration', () => {
  it('encodes the official create-only URL and returns a successful Feishu registration', async () => {
    const qr = vi.fn(), bodies: URLSearchParams[] = []
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(new URLSearchParams(String(init?.body)))
      return response(bodies.length === 1 ? begin : { client_id: 'cli_0123456789abcdef', client_secret: 'secret', user_info: { open_id: 'ou_owner', tenant_brand: 'feishu' } })
    })
    const result = await registerFeishuApp({ source: 'dsh-feishu-im', createOnly: true, signal: new AbortController().signal,
      appPreset: { name: 'dsh', desc: 'Private agent' },
      addons: { preset: false, scopes: { tenant: ['scope'] }, events: { items: { tenant: ['event'] } }, callbacks: { items: ['callback'] } }, onQRCodeReady: qr }, { fetch })
    expect(result).toMatchObject({ client_id: 'cli_0123456789abcdef', user_info: { open_id: 'ou_owner' } })
    expect(Object.fromEntries(bodies[0]!)).toEqual({ action: 'begin', archetype: 'PersonalAgent', auth_method: 'client_secret', request_user_info: 'open_id' })
    expect(Object.fromEntries(bodies[1]!)).toEqual({ action: 'poll', device_code: 'device' })
    const url = new URL(qr.mock.calls[0]![0].url)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ from: 'sdk', source: 'node-sdk/dsh-feishu-im', tp: 'sdk', createOnly: 'true', name: 'dsh', desc: 'Private agent' })
    const addons = JSON.parse(gunzipSync(Buffer.from(url.searchParams.get('addons')!, 'base64url')).toString())
    expect(addons).toEqual({ preset: false, scopes: { tenant: ['scope'] }, events: { items: { tenant: ['event'] } }, callbacks: { items: ['callback'] } })
  })

  it('cancels and joins a begin request that is still pending', async () => {
    const entered = Promise.withResolvers<AbortSignal>(), controller = new AbortController()
    const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal as AbortSignal; entered.resolve(signal)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const registration = registerFeishuApp({ signal: controller.signal, onQRCodeReady: vi.fn() }, { fetch })
    const requestSignal = await entered.promise; controller.abort(new Error('stop'))
    await expect(registration).rejects.toThrow('stop')
    expect(requestSignal.aborted).toBe(true)
  })

  it('cancels an abortable poll delay without leaving its timer active', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetch = vi.fn().mockResolvedValueOnce(response({ ...begin, interval: 5 })).mockResolvedValueOnce(response({ error: 'authorization_pending' }))
    const registration = registerFeishuApp({ signal: controller.signal, onQRCodeReady() {} }, { fetch })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); controller.abort(new Error('stop delay'))
    await expect(registration).rejects.toThrow('stop delay')
    expect(vi.getTimerCount()).toBe(0); vi.useRealTimers()
  })

  it('switches once to Lark, handles pending and slow-down, then succeeds', async () => {
    vi.useFakeTimers()
    const urls: string[] = [], statuses: unknown[] = []
    const replies = [begin, { error: 'authorization_pending' }, { error: 'slow_down' }, { user_info: { tenant_brand: 'lark' } },
      { client_id: 'cli_0123456789abcdef', client_secret: 'secret', user_info: { tenant_brand: 'lark' } }]
    const fetch = vi.fn(async (input: string | URL | Request) => { urls.push(String(input)); return response(replies.shift()) })
    const registration = registerFeishuApp({ onQRCodeReady() {}, onStatusChange: value => statuses.push(value) }, { fetch })
    await vi.runAllTimersAsync()
    await expect(registration).resolves.toMatchObject({ client_secret: 'secret' })
    expect(statuses).toEqual([{ status: 'polling' }, { status: 'slow_down', interval: 5 }, { status: 'domain_switched' }])
    expect(urls.at(-1)).toBe('https://accounts.larksuite.com/oauth/v1/app/registration')
    vi.useRealTimers()
  })

  it.each([
    [{ error: 'access_denied', error_description: 'Denied' }, 'access_denied'],
    [{ error: 'expired_token' }, 'expired_token'],
    [{ error: 'unknown', error_description: 'Bad' }, 'unknown'],
  ])('rejects terminal poll response %j', async (poll, code) => {
    const fetch = vi.fn().mockResolvedValueOnce(response(begin)).mockResolvedValueOnce(response(poll, 400))
    await expect(registerFeishuApp({ onQRCodeReady() {} }, { fetch })).rejects.toMatchObject({ code })
  })

  it('rejects malformed begin data, unsafe QR URLs, HTTP failures and per-request timeouts', async () => {
    await expect(registerFeishuApp({ onQRCodeReady() {} }, { fetch: vi.fn().mockResolvedValue(response({})) })).rejects.toThrow('invalid begin')
    await expect(registerFeishuApp({ onQRCodeReady() {} }, { fetch: vi.fn().mockResolvedValue(response({ ...begin, verification_uri_complete: 'https://attacker.test/' })) })).rejects.toThrow('unexpected QR')
    await expect(registerFeishuApp({ onQRCodeReady() {} }, { fetch: vi.fn().mockResolvedValue(response({ message: 'bad' }, 500)) })).rejects.toThrow('HTTP 500')
    const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal as AbortSignal; signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    await expect(registerFeishuApp({ onQRCodeReady() {} }, { fetch, requestTimeoutMs: 1 })).rejects.toThrow()
  })

  it('uses bounded defaults, preserves a minimal option set and bounds response bodies', async () => {
    const qr = vi.fn()
    const fetch = vi.fn().mockResolvedValueOnce(response({ ...begin, expires_in: Infinity, interval: Infinity }))
      .mockResolvedValueOnce(response({ client_id: 'id', client_secret: 'secret' }))
    await expect(registerFeishuApp({ onQRCodeReady: qr, addons: { scopes: {}, events: { items: {} }, callbacks: {} } }, { fetch })).resolves.toEqual({ client_id: 'id', client_secret: 'secret' })
    expect(qr.mock.calls[0]![0]).toMatchObject({ expireIn: 600 })
    const url = new URL(qr.mock.calls[0]![0].url)
    expect(url.searchParams.get('source')).toBe('node-sdk'); expect(url.searchParams.has('createOnly')).toBe(false)
    expect(JSON.parse(gunzipSync(Buffer.from(url.searchParams.get('addons')!, 'base64url')).toString())).toEqual({ scopes: {}, events: { items: {} }, callbacks: {} })
    const huge = response({ padding: 'x'.repeat(70_000) })
    await expect(registerFeishuApp({ onQRCodeReady() {} }, { fetch: vi.fn().mockResolvedValue(huge) })).rejects.toThrow('size limit')
  })

  it('validates fixture origins, addon values and callback response identities', async () => {
    for (const bad of ['https://127.0.0.1', 'http://example.com', 'http://user@127.0.0.1', 'http://127.0.0.1/path', 'http://127.0.0.1/?q=1', 'http://127.0.0.1/#x']) {
      await expect(registerFeishuApp({ onQRCodeReady() {} }, { feishuOrigin: bad, fetch: vi.fn() })).rejects.toThrow('loopback')
    }
    const invalid = [
      { preset: 'false' }, { scopes: { tenant: [''] } }, { events: { items: { tenant: [''] } } }, { callbacks: { items: [''] } },
    ]
    for (const addons of invalid) {
      const fetch = vi.fn().mockResolvedValueOnce(response(begin))
      await expect(registerFeishuApp({ onQRCodeReady() {}, addons: addons as never }, { fetch })).rejects.toThrow()
    }
    const fetch = vi.fn().mockResolvedValueOnce(response(begin)).mockResolvedValueOnce(response({ client_id: 'id', client_secret: 'secret', user_info: { open_id: 3, tenant_brand: 'other' } }))
    await expect(registerFeishuApp({ onQRCodeReady() {} }, { fetch, feishuOrigin: 'http://127.0.0.1:3001', larkOrigin: 'http://[::1]:3002' })).resolves.toEqual({ client_id: 'id', client_secret: 'secret', user_info: {} })
  })

  it('reports expiry while a poll request is pending and accepts an empty poll response', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockResolvedValueOnce(response({ ...begin, expires_in: 0.001, interval: 0 })).mockResolvedValueOnce(response({}))
      .mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => (init!.signal as AbortSignal).addEventListener('abort', () => reject((init!.signal as AbortSignal).reason), { once: true })))
    const registration = registerFeishuApp({ onQRCodeReady() {} }, { fetch })
    const rejected = expect(registration).rejects.toMatchObject({ code: 'expired_token' })
    await vi.runAllTimersAsync()
    await rejected
  })

  it('normalizes expiry while waiting between polls', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ ...begin, expires_in: 0.001, interval: 0.01 })).mockResolvedValueOnce(response({ error: 'authorization_pending' }))
    const registration = registerFeishuApp({ onQRCodeReady() {} }, { fetch })
    await expect(registration).rejects.toMatchObject({ code: 'expired_token' })
  })

  it('uses global fetch, supports addons without callbacks, and distinguishes poll failures from cancellation', async () => {
    const globalFetch = vi.fn().mockResolvedValueOnce(response(begin)).mockResolvedValueOnce(response({ client_id: 'id', client_secret: 'secret' }))
    vi.stubGlobal('fetch', globalFetch)
    await expect(registerFeishuApp({ onQRCodeReady() {}, addons: { preset: false } })).resolves.toMatchObject({ client_id: 'id' })
    vi.unstubAllGlobals()

    const failed = vi.fn().mockResolvedValueOnce(response(begin)).mockRejectedValueOnce(new Error('poll failed'))
    await expect(registerFeishuApp({ onQRCodeReady() {} }, { fetch: failed })).rejects.toThrow('poll failed')

    const controller = new AbortController()
    const cancelled = vi.fn().mockResolvedValueOnce(response(begin)).mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal as AbortSignal
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const registration = registerFeishuApp({ signal: controller.signal, onQRCodeReady() {} }, { fetch: cancelled })
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(2)); controller.abort(new Error('poll cancelled'))
    await expect(registration).rejects.toThrow('poll cancelled')
  })
})
