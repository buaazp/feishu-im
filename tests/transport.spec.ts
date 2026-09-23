import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import type { LarkMessageId } from '../src/protocol.ts'
import { LarkCli } from '../src/transport.ts'
import { incoming, larkFixture } from './fixture.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function harness(patch: Partial<Config> = {}) {
  const fixture = await larkFixture()
  cleanup.push(() => fixture.close())
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(SubprocessLocal)
  const config: Config = Config({ profile: 'test-app', cwd: process.cwd(), allowedUsers: ['ou_owner'], command: fixture.command, ...patch })
  return { fixture, ctx, config, cli: new LarkCli(ctx, config) }
}

describe('lark-cli process transport', () => {
  it('waits for readiness and closes stdin to drain the consumer', async () => {
    const { fixture, cli } = await harness()
    fixture.setReady(false)
    const controller = new AbortController()
    const ready = vi.fn()
    const receive = vi.fn()
    const running = cli.consume(receive, ready, controller.signal).catch((error: unknown) => error)
    cleanup.push(async () => { controller.abort(); await running })
    await fixture.connected()
    expect(ready).not.toHaveBeenCalled()
    fixture.send(incoming('1', 'hello'))
    fixture.ready()
    await vi.waitFor(() => { expect(receive).toHaveBeenCalledTimes(1) })
    expect(ready).toHaveBeenCalledTimes(1)
    controller.abort()
    await running
    await vi.waitFor(() => { expect(fixture.consumers.size).toBe(0) })
  })

  it('fails on consumer exit and on a missing ready marker', async () => {
    const { fixture, cli } = await harness({ startupTimeoutMs: 500 })
    fixture.setReady(false)
    const running = cli.consume(() => {}, () => {}, new AbortController().signal)
    await expect(running).rejects.toThrow('readiness timed out')
    fixture.setReady(true)
    const next = cli.consume(() => {}, () => { fixture.exit(4) }, new AbortController().signal)
    await expect(next).rejects.toThrow('consumer exited (4)')
  })

  it('pins bot identity, splits literal content, and reuses idempotency keys', async () => {
    const { fixture, cli } = await harness({ maxReplyBytes: 64 })
    const id = brandString<LarkMessageId>('om_1')
    const text = '中🙂"\\\n'.repeat(12)
    await cli.reply(id, 'result', text, new AbortController().signal)
    const first = [...fixture.replies]
    await cli.reply(id, 'result', text, new AbortController().signal)
    expect(first.map(reply => reply.text).join('')).toBe(text)
    expect(fixture.replies.slice(first.length).map(reply => reply.uuid)).toEqual(first.map(reply => reply.uuid))
    expect(first[0]!.args).toEqual(expect.arrayContaining(['--profile', 'test-app', '--as', 'bot']))
  })

  it.each([{ reply: { ok: false } }, { reply: { ok: false }, exitCode: 1 }])('rejects unsuccessful CLI replies %j', async (reply) => {
    const { fixture, cli } = await harness()
    fixture.setReply(() => reply)
    await expect(cli.reply(brandString<LarkMessageId>('om_1'), 'result', 'hello', new AbortController().signal)).rejects.toThrow()
  })

  it('terminates a consumer that ignores stdin EOF', async () => {
    const h = await harness({ graceMs: 100 })
    h.config.command.push('--ignore-stdin')
    const cli = h.cli
    const controller = new AbortController()
    const ready = Promise.withResolvers<undefined>()
    const running = cli.consume(() => {}, () => { ready.resolve(undefined) }, controller.signal)
    cleanup.push(async () => { controller.abort(); await running })
    await ready.promise
    controller.abort()
    await running
    await vi.waitFor(() => { expect(h.fixture.consumers.size).toBe(0) }, { timeout: 20_000 })
  })

  it('retains diagnostics and rejects oversized stderr records', async () => {
    const { fixture, cli } = await harness({ maxRecordBytes: 64 })
    const running = cli.consume(() => {}, () => { fixture.output('', 'x'.repeat(65)) }, new AbortController().signal)
    await expect(running).rejects.toThrow('maxRecordBytes')
    const next = cli.consume(() => {}, () => {
      fixture.output('', 'remote connection exists\n')
      fixture.exit(2)
    }, new AbortController().signal)
    await expect(next).rejects.toThrow('remote connection exists')
  })

  it('ignores blank records and stops dispatching buffered records after cancellation', async () => {
    const { fixture, cli } = await harness()
    const controller = new AbortController()
    const receive = vi.fn(() => { controller.abort() })
    const running = cli.consume(receive, () => { fixture.output('\nfirst\nsecond\n') }, controller.signal)
    cleanup.push(async () => { controller.abort(); await running })
    await running
    expect(receive.mock.calls).toHaveLength(1)
  })

  it('cancels stalled replies at the RPC deadline and when the owner stops', async () => {
    const { fixture, cli } = await harness({ requestTimeoutMs: 500 })
    fixture.setReply(() => undefined)
    const id = brandString<LarkMessageId>('om_1')
    await expect(cli.reply(id, 'result', 'hello', new AbortController().signal)).rejects.toThrow('timed out')
    const controller = new AbortController()
    fixture.setReply(() => { controller.abort(); return undefined })
    await expect(cli.reply(id, 'result', 'hello', controller.signal)).rejects.toThrow()
  })

  it('rejects truncated reply output and propagates spawn failures', async () => {
    const { fixture, cli, ctx } = await harness({ maxRecordBytes: 64 })
    fixture.setReply(() => ({ reply: { ok: true, payload: 'x'.repeat(256) } }))
    const id = brandString<LarkMessageId>('om_1')
    await expect(cli.reply(id, 'result', 'hello', new AbortController().signal)).rejects.toThrow('incomplete')
    vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(() => { throw new Error('spawn unavailable') })
    await expect(cli.reply(id, 'result', 'hello', new AbortController().signal)).rejects.toThrow('spawn unavailable')
  })
})
