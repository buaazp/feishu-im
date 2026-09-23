/** Isolated real Agent services for private-chat lifecycle tests. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import { expect, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { FeishuDriver } from '../src/driver.ts'
import type { MessageTransport } from '../src/feishu-api.ts'
import { incoming } from './fixture.ts'
import { TestModel } from './fixtures/model.ts'

export async function createDriverHarness(cleanup: Array<() => Promise<unknown>>, patch: Partial<Config> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lark-driver-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
  await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' })
  await ctx.plugin(AgentDefaultModel, { provider: 'lark-test', model: 'test' })
  await ctx.plugin(AgentLoop, { agents: [] })
  const model = new TestModel()
  ctx.llm.registerAdapter(['lark-test'], model)
  const config: Config = Config({ appId: 'cli_0123456789abcdef', appSecret: 'fake-secret', cwd: root, allowedUsers: ['ou_owner'], ...patch })
  const cli: MessageTransport = { reply: vi.fn(), card: vi.fn(async () => 'om_progress'), updateCard: vi.fn(async () => {}) }
  const reply = vi.spyOn(cli, 'reply').mockResolvedValue()
  const driver = new FeishuDriver(ctx, config, cli)
  cleanup.push(() => driver.dispose())
  const send = (id: string, text: string, sender?: string) => { driver.receive(JSON.stringify(incoming(id, text, sender))) }
  const waitReply = async (phase: string, text: string) => {
    await vi.waitFor(() => {
      expect(reply.mock.calls.map(call => [call[1], call[2]])).toEqual(expect.arrayContaining([[phase, expect.stringContaining(text)]]))
    }, { timeout: 20_000 })
  }
  const idle = async () => { await vi.waitFor(() => { expect(ctx.agents.roots()).toHaveLength(0) }, { timeout: 20_000 }) }
  return { ctx, cli, model, config, driver, reply, send, waitReply, idle }
}
