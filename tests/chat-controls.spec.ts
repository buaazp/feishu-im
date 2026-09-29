import { afterEach, expect, it, vi } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { freezeMessage, type MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { conversationStore } from '../src/conversation-store.ts'
import { createDriverHarness } from './driver-harness.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
const harness = (patch: Parameters<typeof createDriverHarness>[1] = {}) => createDriverHarness(cleanup, patch)

it('persists directory and task switches, deduplicating commands and old prompts across restarts', async () => {
  const h = await harness({ maxConversations: 1 })
  h.send('one', 'first'); await h.waitReply('result', '第 1 条消息：first'); await h.idle()
  const original = h.ctx.agents.roots()[0]!.session.id
  const next = join(h.config.cwd, 'next project'); await mkdir(next)
  h.send('cd', '/dsh cd next project'); await h.waitReply('cd', next)
  h.send('two', 'other directory'); await h.waitReply('result', '第 1 条消息：other directory'); await h.idle()
  const current = h.ctx.agents.roots().find(agent => agent.session.id !== original)!
  expect(current.session.header.cwd).toBe(next)
  expect(h.ctx.workspaceRegistry.list().flatMap(workspace => workspace.sessionIds)).toEqual([])
  await h.restart()
  h.send('one', 'first'); h.send('cd', '/dsh cd next project'); h.send('three', 'continue')
  await h.waitReply('result', '第 2 条消息：continue'); await h.idle()
  expect(h.ctx.agents.roots()[0]!.session.id).toBe(current.session.id)
  h.send('new', '/dsh new'); await h.waitReply('new', '新任务')
  h.send('four', 'fresh'); await h.waitReply('result', '第 1 条消息：fresh'); await h.idle()
  const fresh = h.ctx.agents.roots().find(agent => agent.session.id !== current.session.id)!.session.id
  await h.restart(); h.send('new', '/dsh new'); h.send('five', 'continue fresh')
  await h.waitReply('result', '第 2 条消息：continue fresh'); await h.idle()
  expect(h.ctx.agents.roots()[0]!.session.id).toBe(fresh)
  expect(h.model.requests).toHaveLength(5)
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toEqual([])
})

it('archives running work, cancels its queue and does not replay a duplicate archive on the next task', async () => {
  const h = await harness()
  h.send('hold', 'hold'); await h.model.entered.promise
  const archived = h.ctx.agents.roots()[0]!.session.id
  h.send('queued', 'must not run'); h.send('archive', '/dsh archive')
  await h.waitReply('archive', '已归档'); await h.idle()
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toEqual([archived])
  expect(h.ctx.agents.roots()).toHaveLength(0)
  expect(h.model.requests).toHaveLength(1)
  await h.restart()
  h.send('after', 'fresh'); await h.waitReply('result', '第 1 条消息：fresh'); await h.idle()
  const current = h.ctx.agents.roots()[0]!.session.id
  h.send('archive', '/dsh archive'); h.send('hold', 'hold'); await h.idle()
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toEqual([archived])
  expect(h.ctx.agents.roots()[0]!.session.id).toBe(current)
  expect(h.model.requests).toHaveLength(2)
})

it('recovers a durable archive intent after a storage failure without repeating task execution', async () => {
  const h = await harness()
  h.send('one', 'first'); await h.waitReply('result', '第 1 条消息'); await h.idle()
  const id = h.ctx.agents.roots()[0]!.session.id
  const archive = vi.spyOn(h.ctx.workspaceRegistry, 'archiveSession').mockRejectedValueOnce(new Error('storage unavailable'))
  h.send('archive', '/dsh archive'); await h.waitReply('failure', '启动失败'); await h.idle()
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toEqual([])
  archive.mockRestore(); await h.restart()
  h.send('archive', '/dsh archive'); h.send('two', 'fresh')
  await h.waitReply('result', '第 1 条消息：fresh'); await h.idle()
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toEqual([id])
  expect(h.model.requests).toHaveLength(2)
})

it('respects an archive from dsh and can archive a cold task after restart', async () => {
  const h = await harness()
  h.send('empty', '/dsh archive'); await h.waitReply('archive', '没有运行')
  h.send('one', 'first'); await h.waitReply('result', '第 1 条消息'); await h.idle()
  const first = h.ctx.agents.roots()[0]!.session.id
  await h.ctx.workspaceRegistry.archiveSession(first)
  h.send('two', 'after dsh archive'); await h.waitReply('result', '第 1 条消息：after dsh archive'); await h.idle()
  await h.restart()
  h.send('coldarchive', '/dsh archive'); await h.waitReply('archive', '已归档'); await h.idle()
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toHaveLength(2)
  h.send('emptyagain', '/dsh archive'); await h.waitReply('archive', '没有运行'); await h.idle()
})

it('rejects active switches and invalid directories, and expands home paths explicitly', async () => {
  const h = await harness()
  h.send('hold', 'hold'); await h.model.entered.promise
  h.send('new', '/dsh new'); h.send('cd', '/dsh cd /')
  await h.waitReply('busy', '等待当前任务完成')
  h.send('stop', '/dsh stop'); await h.idle()
  h.send('invalid', '/dsh cd /does-not-exist-feishu-test'); await h.waitReply('cd', '不可用')
  h.send('home', '/dsh cd ~'); await h.waitReply('cd', homedir()); await h.idle()
  h.send('homeagain', '/dsh cd ~/'); await h.idle()
  h.send('status', '/dsh status'); await h.waitReply('status', homedir())
  h.ctx.provide('settings', { documentPath: join(h.config.cwd, 'settings.yaml') } as unknown as typeof h.ctx.settings)
  h.send('profile', `/dsh cd ${h.config.cwd}`); await h.idle()
  expect(h.reply.mock.calls.at(-1)?.[2]).toContain('不可用')
})

it('does not clear a dsh turn running on a retained task', async () => {
  const h = await harness()
  h.send('first', 'first'); await h.waitReply('result', '第 1 条消息'); await h.idle()
  const agent = h.ctx.agents.roots()[0]!
  agent.followup(freezeMessage<UserMessage>({ id: brandString<MessageId>('web:hold'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hold' }] }))
  await h.model.entered.promise
  h.send('during', 'feishu during web task'); await h.waitReply('busy', '暂时无法接收')
  h.send('webstatus', '/dsh status'); await h.waitReply('status', '处理中')
  h.send('webnew', '/dsh new'); h.send('webcd', '/dsh cd .'); await h.waitReply('busy', '等待当前任务完成')
  expect(h.model.requests).toHaveLength(2)
  h.send('webstop', '/dsh stop'); await h.idle()
  expect(agent.status).toBe('idle')
  agent.followup(freezeMessage<UserMessage>({ id: brandString<MessageId>('web:holdagain'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hold' }] }))
  await vi.waitFor(() => expect(h.model.requests).toHaveLength(3))
  h.send('webarchive', '/dsh archive'); await h.waitReply('archive', '已归档'); await h.idle()
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toEqual([agent.session.id])
})

it('cancels pending creation before archive checks whether a task exists', async () => {
  const h = await harness(), gate = Promise.withResolvers<void>()
  cleanup.push(async () => { gate.resolve() })
  const create = h.ctx.agents.create.bind(h.ctx.agents)
  const delayed = vi.spyOn(h.ctx.agents, 'create').mockImplementation(async options => { await gate.promise; return create(options) })
  h.send('pending', 'must not execute')
  await vi.waitFor(() => expect(delayed).toHaveBeenCalled())
  h.send('archivepending', '/dsh archive')
  await vi.waitFor(() => expect(delayed.mock.calls[0]![0]!.signal!.aborted).toBe(true))
  gate.resolve(); await h.waitReply('archive', '已停止'); await h.idle()
  expect(h.model.requests).toHaveLength(0)
  expect(h.ctx.agents.roots()).toHaveLength(0)
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toEqual([])
})

it('stops active work immediately when admission is full and blocked on another chat', async () => {
  const { incoming } = await import('./fixture.ts')
  const h = await harness({ maxPendingMessages: 1, maxConcurrentReplies: 1 })
  h.send('hold', 'hold'); await h.model.entered.promise
  const gate = Promise.withResolvers<undefined>()
  cleanup.push(async () => { gate.resolve(undefined) })
  const lookup = vi.spyOn(h.ctx.sessionPersistence, 'stat').mockImplementationOnce(() => gate.promise)
  h.driver.receive(JSON.stringify({ ...incoming('other', '/dsh status'), chat_id: 'oc_other' }))
  await vi.waitFor(() => expect(lookup).toHaveBeenCalled())
  h.send('queued', 'must not execute'); h.send('overflow', 'must not execute')
  await h.waitReply('busy', '暂时无法接收')
  h.send('urgent', '/dsh stop'); h.send('duplicateurgent', '/dsh stop')
  await vi.waitFor(() => expect(h.ctx.agents.roots()[0]!.status).toBe('idle'))
  gate.resolve(undefined); await h.idle()
  expect(h.model.requests).toHaveLength(1)
  h.send('afterstop', 'after stop'); await h.waitReply('result', 'after stop'); await h.idle()
  h.send('urgent', '/dsh stop'); await h.idle()
  expect(h.reply.mock.calls.filter(call => call[0] === 'om_urgent')).toHaveLength(1)
})

it('contains domain-close failures after releasing task handles', async () => {
  const h = await harness(), open = h.ctx.storageDomain.open.bind(h.ctx.storageDomain)
  const closed = vi.fn(async () => { throw new Error('close failed') })
  vi.spyOn(h.ctx.storageDomain, 'open').mockImplementation(async () => {
    const domain = await open(conversationStore)
    const close = domain.close.bind(domain)
    vi.spyOn(domain, 'close').mockImplementationOnce(async () => { await close(); await closed() })
    return domain
  })
  h.send('one', 'first'); await h.waitReply('result', '第 1 条消息'); await h.idle()
  await expect(h.driver.dispose()).resolves.toBeUndefined()
  expect(closed).toHaveBeenCalledOnce()
  expect(h.ctx.agents.roots()).toHaveLength(0)
})

it('stops work that begins while the stop command waits for admission', async () => {
  const { incoming } = await import('./fixture.ts')
  const h = await harness()
  h.send('initial', 'first'); h.send('initialstop', '/dsh stop')
  await h.waitReply('stop', '已请求停止'); await h.idle()
  h.send('second', 'second'); await h.waitReply('result', 'second'); await h.idle()
  const agent = h.ctx.agents.roots()[0]!
  const gate = Promise.withResolvers<undefined>()
  cleanup.push(async () => { gate.resolve(undefined) })
  const lookup = vi.spyOn(h.ctx.sessionPersistence, 'stat').mockImplementationOnce(() => gate.promise)
  h.driver.receive(JSON.stringify({ ...incoming('other', '/dsh status'), chat_id: 'oc_other' }))
  await vi.waitFor(() => expect(lookup).toHaveBeenCalled())
  h.send('stopbeforeweb', '/dsh stop')
  agent.followup(freezeMessage<UserMessage>({ id: brandString<MessageId>('web:delayed'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hold' }] }))
  await h.model.entered.promise
  gate.resolve(undefined); await h.driver.whenIdle(); await agent.whenIdle(); await h.idle()
  expect(agent.status).toBe('idle')
})

it('keeps log-backed deduplication when restoring a stale routing backup', async () => {
  const { conversationId, parseMessage } = await import('../src/protocol.ts')
  const { incoming } = await import('./fixture.ts')
  const h = await harness()
  h.send('original', 'first'); await h.waitReply('result', '第 1 条消息'); await h.idle(); await h.restart()
  const domain = await h.ctx.storageDomain.open(conversationStore)
  const key = conversationId(h.config.appId, '', parseMessage(JSON.stringify(incoming('original', 'first')))!)
  await domain.table('chats').update(key, value => ({ ...value, admitted: [] })); await domain.close()
  h.send('original', 'first'); await h.idle()
  expect(h.model.requests).toHaveLength(1)
})

it('bounds and drains admission while storage opens, and contains a failed open', async () => {
  const h = await harness({ maxPendingMessages: 1, maxConcurrentReplies: 1 })
  const open = h.ctx.storageDomain.open.bind(h.ctx.storageDomain)
  const gate = Promise.withResolvers<void>()
  cleanup.push(async () => { gate.resolve() })
  vi.spyOn(h.ctx.storageDomain, 'open').mockImplementation(async () => { await gate.promise; return open(conversationStore) })
  h.send('first', 'first'); h.send('second', 'second'); h.send('third', 'third')
  await h.waitReply('busy', '暂时无法接收')
  const closed = h.driver.dispose(); gate.resolve(); await closed
  expect(h.model.requests).toHaveLength(0)
  const failed = await harness()
  const opening = vi.spyOn(failed.ctx.storageDomain, 'open').mockRejectedValueOnce(new Error('storage failed'))
  failed.send('bad', 'first'); await failed.waitReply('failure', '启动失败')
  opening.mockRestore()
  failed.send('retry', 'later prompt'); await failed.waitReply('result', '第 1 条消息：later prompt')
  await failed.driver.dispose()
})

it.each(['/dsh new', '/dsh cd .'])('imports legacy admissions before %s and suppresses old prompts after restart', async command => {
  const { conversationId, parseMessage } = await import('../src/protocol.ts')
  const { installModelSelection } = await import('@deepseek-ai/dsh-agent')
  const { incoming } = await import('./fixture.ts')
  const h = await harness()
  const id = conversationId(h.config.appId, h.config.cwd, parseMessage(JSON.stringify(incoming('legacy', 'first')))!)
  const owner = await h.ctx.agents.create({ sessionId: id, meta: { cwd: h.config.cwd }, setup: ctx => {
    installModelSelection(ctx, { current: h.ctx.agentDefaultModel.currentSelection(), assembled: undefined })
  } })
  owner.agent.followup(freezeMessage<UserMessage>({ id: brandString<MessageId>('lark:om_legacy'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] }))
  await owner.agent.whenIdle()
  owner.agent.followup(freezeMessage<UserMessage>({ id: brandString<MessageId>('web:info'), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'dsh context' }] }))
  await owner.agent.whenIdle()
  await h.ctx.sessions.flush(owner.agent.session); await owner.dispose()
  h.send('switchlegacy', command); await h.idle(); await h.restart()
  h.send('legacy', 'first'); await h.idle()
  expect(h.model.requests).toHaveLength(2)
  expect(h.reply.mock.calls.some(call => call[0] === 'om_legacy')).toBe(false)
  await h.driver.dispose()
  const domain = await h.ctx.storageDomain.open(conversationStore)
  await domain.table('chats').delete(conversationId(h.config.appId, '', parseMessage(JSON.stringify(incoming('legacy', 'first')))!))
  await domain.close(); await h.restart()
  h.send('archivelegacy', '/dsh archive'); await h.waitReply('archive', '已归档'); await h.idle()
  expect(h.ctx.workspaceRegistry.archivedSessionIds).toEqual([id])
})
