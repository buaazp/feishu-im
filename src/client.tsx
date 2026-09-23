/** Configuration page contributed to the installed bundle's Plugins detail view. */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc, ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

declare module '@deepseek-ai/cordis' { interface Context { connection: ConnectionHandle } }

interface Status {
  config: { appId: string; cwd: string; locale: 'zh-CN' | 'en'; allowedUsers: string[]; apiOrigin: string }
  hasSecret: boolean; writable: boolean; revision: number; state: string; error: string
  qr: { state: string; image?: string; expiresAt?: number } | null
  pairing: { code: string; expiresAt: number } | null
}
interface Props extends PluginConfigViewProps { rpc: ClientConnectionRpc; locale: LocaleRuntime }
const copy = {
  zh: { summary: '扫码连接飞书，让机器人协助你完成 dsh 任务。', title: '连接飞书', intro: '配置机器人后，在飞书私聊中发送任务，并通过卡片查看进展、回答问题和确认操作。',
    qr: '扫码创建机器人', manual: '使用已有应用', workspace: '任务工作目录', workspaceHint: '机器人将在这个目录中执行任务，请填写绝对路径。', generate: '生成二维码', cancel: '取消扫码', scan: '使用飞书扫描二维码，并在手机上确认创建应用。',
    appId: 'App ID', secret: 'App Secret', secretSaved: '已保存，留空保持不变', secretNew: '输入应用密钥', region: '应用区域', users: '已授权用户', usersHint: '填写用户 open_id，以逗号分隔。也可以保存后使用下方配对码授权。',
    save: '保存并连接', saved: '配置已保存', refresh: '刷新配置', pair: '生成授权配对码', pairHint: '用你自己的飞书账号私聊此机器人，发送以下指令。配对码 10 分钟内有效，只能使用一次。', disconnect: '断开并清除凭据',
    setup: '已有应用需要开启机器人能力，并发布应用；在“事件与回调”中选择长连接，订阅接收消息事件和卡片回传交互。', setupLink: '打开飞书开发者后台',
    qrHelp: '扫码创建由飞书官方提供。如果组织尚未开放此功能，或需要管理员审批，可以使用已有应用。',
    states: { unconfigured: '尚未配置', connecting: '正在连接', connected: '已连接', reconnecting: '正在重连', error: '连接失败', stopped: '已停止' },
    qrStates: { starting: '正在生成二维码…', waiting: '等待扫码确认', complete: '配置完成', failed: '扫码未完成，请重试或使用已有应用。', cancelled: '扫码已取消' },
    errors: { configuration_failed: '保存失败，请检查配置后重试。', bot_authentication_failed: '无法验证机器人，请检查 App ID、App Secret 和机器人能力。', invalid_workspace: '工作目录不存在或不可读写，请填写有效的绝对路径。', profile_is_not_workspace: '请选择 dsh 配置目录之外的任务工作目录。', settings_changed: '配置已在其他页面更改，请刷新后重试。', settings_readonly: '当前配置只读。', not_connected: '请先连接机器人。', network: '无法连接 dsh，请检查服务是否运行。' },
    connectionHelp: '请检查应用凭据、长连接配置和网络，然后重新保存连接。', none: '尚无用户获得授权，机器人不会执行任务。', readonly: '当前配置只读。', language: '机器人提示语言', busy: '处理中…' },
  en: { summary: 'Connect Feishu and run dsh tasks in private bot chats.', title: 'Connect Feishu', intro: 'Send tasks in a private bot chat. Cards show progress, collect answers and request approval.',
    qr: 'Create a bot with QR', manual: 'Use an existing app', workspace: 'Task workspace', workspaceHint: 'An absolute directory where the bot will run tasks.', generate: 'Generate QR code', cancel: 'Cancel scan', scan: 'Scan with Feishu and confirm app creation on your phone.',
    appId: 'App ID', secret: 'App Secret', secretSaved: 'Saved; leave blank to keep', secretNew: 'Enter application secret', region: 'App region', users: 'Authorized users', usersHint: 'Human open_ids, separated by commas. You can also authorize with a pairing code after saving.',
    save: 'Save and connect', saved: 'Configuration saved', refresh: 'Reload settings', pair: 'Generate pairing code', pairHint: 'Send this command to the bot in a private chat from your own Feishu account. The code expires in 10 minutes and works once.', disconnect: 'Disconnect and clear credentials',
    setup: 'Enable the bot capability and publish the app. Under Events & Callbacks, select long connection and subscribe to message receipt and card action callbacks.', setupLink: 'Open Feishu developer console',
    qrHelp: 'QR app creation is provided by Feishu. If unavailable for your organization or awaiting admin approval, use an existing app.',
    states: { unconfigured: 'Not configured', connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', error: 'Connection failed', stopped: 'Stopped' },
    qrStates: { starting: 'Generating QR code…', waiting: 'Waiting for confirmation', complete: 'Configured', failed: 'Registration did not complete. Retry or use an existing app.', cancelled: 'Scan cancelled' },
    errors: { configuration_failed: 'Could not save. Check your settings and retry.', bot_authentication_failed: 'Could not verify the bot. Check App ID, App Secret and bot capability.', invalid_workspace: 'Enter an existing, readable and writable absolute workspace path.', profile_is_not_workspace: 'Choose a task directory outside the dsh profile.', settings_changed: 'Settings changed in another page. Reload before retrying.', settings_readonly: 'These settings are read-only.', not_connected: 'Connect the bot first.', network: 'Cannot connect to dsh. Check that it is running.' },
    connectionHelp: 'Check credentials, long-connection settings and network, then save to reconnect.', none: 'No users are authorized. The bot will not execute tasks.', readonly: 'These settings are read-only.', language: 'Bot control language', busy: 'Working…' },
}
const styles = `.feishu-settings{max-width:650px;display:grid;gap:20px;font-size:14px;line-height:1.6;color:inherit}.feishu-settings h2{font-size:21px;font-weight:650;margin:0}.feishu-settings p{margin:6px 0;opacity:.8}.feishu-settings label{display:grid;gap:6px;font-weight:550}.feishu-settings input,.feishu-settings select,.feishu-settings textarea{width:100%;box-sizing:border-box;border:1px solid color-mix(in srgb,currentColor 24%,transparent);border-radius:8px;padding:10px 12px;background:transparent;color:inherit;font:inherit}.feishu-settings input:focus-visible,.feishu-settings textarea:focus-visible,.feishu-settings select:focus-visible,.feishu-settings button:focus-visible{outline:2px solid #6384e6;outline-offset:3px}.feishu-settings button{border:1px solid color-mix(in srgb,currentColor 24%,transparent);border-radius:8px;padding:9px 14px;background:transparent;color:inherit;font:inherit;cursor:pointer}.feishu-settings button.primary{background:#315bc3;border-color:#315bc3;color:#fff}.feishu-settings button:disabled{opacity:.45;cursor:default}.feishu-settings .tabs{display:flex;gap:8px;flex-wrap:wrap}.feishu-settings .tabs [aria-pressed=true]{background:color-mix(in srgb,#6384e6 15%,transparent);border-color:#6384e6}.feishu-settings .panel{display:grid;gap:16px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;padding:20px}.feishu-settings .status{display:inline-flex;align-items:center;gap:8px;font-size:13px;padding:5px 10px;border-radius:20px;background:color-mix(in srgb,currentColor 7%,transparent)}.feishu-settings .status::before{content:'';width:7px;height:7px;background:#888;border-radius:50%}.feishu-settings .status[data-state=connected]::before{background:#2aa66e}.feishu-settings .error{color:#c64747}.feishu-settings .qr-image{width:232px;height:232px;max-width:100%;margin:auto;background:white;border-radius:10px}.feishu-settings code{display:block;overflow-wrap:anywhere;padding:12px;border-radius:8px;background:color-mix(in srgb,currentColor 6%,transparent);user-select:all}.feishu-settings small{opacity:.72;font-weight:400}.feishu-settings a{color:#6384e6;text-decoration:underline}.feishu-settings fieldset{border:0;padding:0;margin:0;display:grid;gap:16px;min-width:0}@media(max-width:500px){.feishu-settings .panel{padding:14px}.feishu-settings .tabs button{flex:1}}`

export function FeishuPage({ rpc, locale, view }: Props) {
  const language = useSyncExternalStore(listener => locale.subscribe(listener), () => locale.getSnapshot()).active
  const t = copy[language.startsWith('zh') ? 'zh' : 'en']
  const [status, setStatus] = useState<Status>(), [tab, setTab] = useState<'qr' | 'manual'>('qr')
  const [form, setForm] = useState({ appId: '', appSecret: '', cwd: '', allowedUsers: '', region: 'feishu', locale: 'zh-CN' })
  const revision = useRef<number>(), initialized = useRef(false), dirty = useRef(false), lifetime = useRef<AbortController>()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const adopt = (value: Status, reset = false) => {
    setStatus(value)
    if (!initialized.current || reset || (!dirty.current && value.revision !== revision.current)) {
      initialized.current = true; dirty.current = false; revision.current = value.revision
      setForm({ appId: value.config.appId, appSecret: '', cwd: value.config.cwd, allowedUsers: value.config.allowedUsers.join(', '), region: value.config.apiOrigin.includes('larksuite') ? 'lark' : 'feishu', locale: value.config.locale })
      if (value.config.appId) setTab('manual')
    }
  }
  useEffect(() => {
    if (view === 'summary') return
    const controller = new AbortController(); lifetime.current = controller
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await rpc.call('/api', 'feishu-im/status', {}, controller.signal)
        if (!controller.signal.aborted) {
          if (result.ok) adopt(result.value as Status)
          else setError(result.error.code)
        }
      } catch { if (!controller.signal.aborted) setError('network') }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, 2000)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [rpc, view])
  const perform = async (endpoint: string, fields: object = {}) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await rpc.call('/api', `feishu-im/${endpoint}`, { revision: revision.current, ...fields }, lifetime.current?.signal)
      if (!result.ok) { setError(result.error.code); return }
      if (endpoint === 'qrStart') dirty.current = false
      const reset = ['save', 'disconnect', 'status'].includes(endpoint)
      adopt(result.value as Status, reset)
      if (endpoint === 'save') setNotice(t.saved)
    } catch { if (!lifetime.current?.signal.aborted) setError('network') }
    finally { setBusy(false) }
  }
  const field = (key: keyof typeof form, value: string) => { dirty.current = true; setForm(current => ({ ...current, [key]: value })) }
  if (view === 'summary') return <span>{t.summary}</span>
  return <section className="feishu-settings" aria-label="Feishu IM">
    <style>{styles}</style>
    <div><h2>{t.title}</h2><p>{t.intro}</p></div>
    <div role="status" aria-live="polite"><span className="status" data-state={status?.state}>{status ? t.states[status.state as keyof typeof t.states] : t.busy}</span>
      {status?.error && <p className="error">{t.connectionHelp}</p>}
      {notice && <p>{notice}</p>}</div>
    {error && <p role="alert" className="error">{t.errors[error as keyof typeof t.errors] ?? t.errors.configuration_failed}</p>}
    {status && !status.writable && <p>{t.readonly}</p>}
    <fieldset disabled={busy || !status?.writable}>
      <label>{t.workspace}<input value={form.cwd} onChange={e => field('cwd', e.target.value)} placeholder="/Users/you/projects" spellCheck={false} /><small>{t.workspaceHint}</small></label>
      <div className="tabs"><button type="button" aria-pressed={tab === 'qr'} onClick={() => setTab('qr')}>{t.qr}</button><button type="button" aria-pressed={tab === 'manual'} onClick={() => setTab('manual')}>{t.manual}</button></div>
      {tab === 'qr' ? <div className="panel">
        {status?.qr?.image && <img className="qr-image" src={status.qr.image} alt={t.scan} />}
        <p role="status">{status?.qr ? t.qrStates[status.qr.state as keyof typeof t.qrStates] : t.scan}</p>
        <div className="tabs"><button className="primary" type="button" onClick={() => void perform('qrStart', { cwd: form.cwd })}>{t.generate}</button>
          {status?.qr && <button type="button" onClick={() => void perform('qrCancel')}>{t.cancel}</button>}</div>
        <small>{t.qrHelp}</small>
      </div> : <form className="panel" onSubmit={e => { e.preventDefault(); void perform('save', { ...form, allowedUsers: form.allowedUsers.split(/[\s,]+/).filter(Boolean) }) }}>
        <label>{t.appId}<input required value={form.appId} onChange={e => field('appId', e.target.value)} placeholder="cli_…" autoComplete="off" spellCheck={false} /></label>
        <label>{t.secret}<input type="password" value={form.appSecret} onChange={e => field('appSecret', e.target.value)} placeholder={status?.hasSecret && status.config.appId === form.appId ? t.secretSaved : t.secretNew} autoComplete="new-password" /></label>
        <label>{t.region}<select value={form.region} onChange={e => field('region', e.target.value)}><option value="feishu">飞书</option><option value="lark">Lark</option></select></label>
        <label>{t.language}<select value={form.locale} onChange={e => field('locale', e.target.value)}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
        <label>{t.users}<textarea rows={2} value={form.allowedUsers} onChange={e => field('allowedUsers', e.target.value)} placeholder="ou_…" spellCheck={false} /><small>{t.usersHint}</small></label>
        <p><small>{t.setup} <a href={form.region === 'lark' ? 'https://open.larksuite.com/app' : 'https://open.feishu.cn/app'} target="_blank" rel="noreferrer">{t.setupLink}</a></small></p>
        <code>im:message:send_as_bot · im:message.p2p_msg:readonly<br />im.message.receive_v1 · card.action.trigger</code>
        <button className="primary" type="submit">{busy ? t.busy : t.save}</button>
      </form>}
      {status?.config.appId && <div className="panel">
        <strong>{t.users}</strong>
        <p>{status.config.allowedUsers.length ? status.config.allowedUsers.join(', ') : t.none}</p>
        <button type="button" disabled={status.state !== 'connected'} onClick={() => void perform('pairStart')}>{t.pair}</button>
        {status.pairing && <><p>{t.pairHint}</p><code>/dsh pair {status.pairing.code}</code></>}
      </div>}
      <div className="tabs"><button type="button" onClick={() => void perform('status')}>{t.refresh}</button>
        {status?.hasSecret && <button type="button" onClick={() => void perform('disconnect')}>{t.disconnect}</button>}</div>
    </fieldset>
  </section>
}

export const inject = ['slots', 'connection', 'locale']
export function apply(ctx: Context): void {
  const face = () => ({ rpc: ctx.connection.rpc, locale: ctx.locale })
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-feishu-im', inject: face }, FeishuPage))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: 'dsh-feishu-im#feishu-im', inject: face }, FeishuPage))
}
