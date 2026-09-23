/** Cancellable subset of the official Feishu app-registration protocol used by setup. */
import { gzipSync } from 'node:zlib'
import type { registerApp } from '@larksuiteoapi/node-sdk'
import { readJson } from './feishu-api.ts'

type SdkOptions = Parameters<typeof registerApp>[0]
export type RegisterFeishuAppOptions = Pick<SdkOptions, 'source' | 'signal' | 'onQRCodeReady' | 'onStatusChange' | 'createOnly'> & {
  appPreset?: Pick<NonNullable<SdkOptions['appPreset']>, 'name' | 'desc'>
  addons?: { preset?: boolean; scopes?: { tenant?: string[] }; events?: { items?: { tenant?: string[] } }; callbacks?: { items?: string[] } }
}
export type RegisterFeishuAppResult = Awaited<ReturnType<typeof registerApp>>

interface RegistrationDependencies {
  fetch?: typeof globalThis.fetch
  feishuOrigin?: string
  larkOrigin?: string
  requestTimeoutMs?: number
}

const endpoint = '/oauth/v1/app/registration'
const production = { feishu: 'https://accounts.feishu.cn', lark: 'https://accounts.larksuite.com' }
const error = (code: string, description: string): { code: string; description: string } => ({ code, description })

function origin(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('registration fixture origin must be loopback HTTP')
  }
  return url.origin
}

function array(value: string[] | undefined, path: string): string[] | undefined {
  if (value?.some(item => typeof item !== 'string' || item === '')) throw new Error(`${path} must contain non-empty strings`)
  return value
}

function encodeAddons(value: NonNullable<RegisterFeishuAppOptions['addons']>): string {
  if (value.preset !== undefined && typeof value.preset !== 'boolean') throw new Error('addons.preset must be a boolean')
  const normalized = {
    ...(value.preset === undefined ? {} : { preset: value.preset }),
    ...(value.scopes ? { scopes: { tenant: array(value.scopes.tenant, 'addons.scopes.tenant') } } : {}),
    ...(value.events?.items ? { events: { items: { tenant: array(value.events.items.tenant, 'addons.events.items.tenant') } } } : {}),
    ...(value.callbacks ? { callbacks: { items: array(value.callbacks.items, 'addons.callbacks.items') } } : {}),
  }
  return gzipSync(JSON.stringify(normalized)).toString('base64url')
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms)
    function done() { signal.removeEventListener('abort', aborted); resolve() }
    function aborted() { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(signal.reason) }
    signal.addEventListener('abort', aborted, { once: true })
  })
}

/**
 * Register a personal Agent app without the SDK's uncancellable initial HTTP request.
 * Protocol source: @larksuiteoapi/node-sdk 1.74.0 `registerApp` and its README:
 * https://github.com/larksuite/node-sdk/blob/1889911f0841e669de0be5bd02c737a3f1fd20fa/README.md#app-registration
 */
export async function registerFeishuApp(options: RegisterFeishuAppOptions, dependencies: RegistrationDependencies = {}): Promise<RegisterFeishuAppResult> {
  const fetcher = dependencies.fetch ?? globalThis.fetch
  const feishu = origin(dependencies.feishuOrigin, production.feishu), lark = origin(dependencies.larkOrigin, production.lark)
  const requestTimeoutMs = dependencies.requestTimeoutMs ?? 30_000
  const request = async (base: string, fields: Record<string, string>, lifetime: AbortSignal): Promise<Record<string, unknown>> => {
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(requestTimeoutMs)])
    const response = await fetcher(`${base}${endpoint}`, { method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) })
    if (!response.ok && response.status !== 400) { await response.body?.cancel(); throw new Error(`registration HTTP ${response.status}`) }
    return readJson(response.ok ? response : new Response(response.body, { status: 200 }), 65_536)
  }

  const external = options.signal ?? new AbortController().signal
  external.throwIfAborted()
  const begun = await request(feishu, { action: 'begin', archetype: 'PersonalAgent', auth_method: 'client_secret', request_user_info: 'open_id' }, external)
  if (typeof begun.device_code !== 'string' || typeof begun.verification_uri_complete !== 'string') throw new Error('registration returned invalid begin response')
  const qr = new URL(begun.verification_uri_complete)
  if (qr.protocol !== 'https:' || !['accounts.feishu.cn', 'accounts.larksuite.com'].includes(qr.hostname)) throw new Error('registration returned unexpected QR URL')
  qr.searchParams.set('from', 'sdk'); qr.searchParams.set('source', options.source ? `node-sdk/${options.source}` : 'node-sdk'); qr.searchParams.set('tp', 'sdk')
  if (options.createOnly) qr.searchParams.set('createOnly', 'true')
  if (options.appPreset?.name !== undefined) qr.searchParams.set('name', options.appPreset.name)
  if (options.appPreset?.desc !== undefined) qr.searchParams.set('desc', options.appPreset.desc)
  if (options.addons) qr.searchParams.set('addons', encodeAddons(options.addons))
  const expires = typeof begun.expires_in === 'number' && Number.isFinite(begun.expires_in) && begun.expires_in > 0 ? Math.min(begun.expires_in, 600) : 600
  let interval = (typeof begun.interval === 'number' && Number.isFinite(begun.interval) && begun.interval >= 0 ? Math.min(begun.interval, 60) : 5) * 1000
  options.onQRCodeReady({ url: qr.toString(), expireIn: expires })
  const lifetime = AbortSignal.any([external, AbortSignal.timeout(expires * 1000)])
  const cancellation = () => external.aborted ? external.reason : error('expired_token', 'Polling timed out')
  let base = feishu, switched = false, first = true
  while (true) {
    if (!first) try { await delay(interval, lifetime) } catch { throw cancellation() }
    first = false
    let polled: Record<string, unknown>
    try { polled = await request(base, { action: 'poll', device_code: begun.device_code }, lifetime) }
    catch (cause) { if (lifetime.aborted) throw cancellation(); throw cause }
    const user = polled.user_info && typeof polled.user_info === 'object' && !Array.isArray(polled.user_info) ? polled.user_info as Record<string, unknown> : undefined
    if (user?.tenant_brand === 'lark' && !switched) { base = lark; switched = true; options.onStatusChange?.({ status: 'domain_switched' }); first = true; continue }
    if (typeof polled.client_id === 'string' && typeof polled.client_secret === 'string') {
      const result: RegisterFeishuAppResult = { client_id: polled.client_id, client_secret: polled.client_secret }
      if (user) result.user_info = {
        ...(typeof user.open_id === 'string' ? { open_id: user.open_id } : {}),
        ...(user.tenant_brand === 'feishu' || user.tenant_brand === 'lark' ? { tenant_brand: user.tenant_brand } : {}),
      }
      return result
    }
    if (polled.error === 'authorization_pending') options.onStatusChange?.({ status: 'polling' })
    else if (polled.error === 'slow_down') { interval = Math.min(interval + 5000, 60_000); options.onStatusChange?.({ status: 'slow_down', interval: interval / 1000 }) }
    else if (typeof polled.error === 'string') throw error(polled.error, typeof polled.error_description === 'string' ? polled.error_description : 'Unknown error')
  }
}
