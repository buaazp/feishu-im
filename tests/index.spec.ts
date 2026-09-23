import { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config } from '../src/index.ts'
import { createDriverHarness } from './driver-harness.ts'
import { incoming, larkFixture } from './fixture.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

describe('Lark plugin lifetime', () => {
  it('requires a profile launcher', async () => {
    const ctx = new Context()
    cleanup.push(() => ctx.fiber.dispose())
    expect(() => { apply(ctx, Config({ profile: 'test', cwd: process.cwd(), allowedUsers: ['ou_owner'] })) })
      .toThrow('launch through a dsh profile')
  })

  it('dispatches ready ingress and requests a failing application exit on consumer failure', async () => {
    const fixture = await larkFixture()
    cleanup.push(() => fixture.close())
    const h = await createDriverHarness(cleanup, { command: fixture.command })
    await h.ctx.plugin(SubprocessLocal)
    const exit = vi.fn()
    provideCmdline(h.ctx, { args: [], exit })
    apply(h.ctx, h.config)
    await fixture.connected()
    fixture.send(incoming('help', '/dsh help'))
    await vi.waitFor(() => { expect(fixture.replies[0]?.text).toContain('/dsh status') }, { timeout: 20_000 })
    fixture.exit(2)
    await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(1) }, { timeout: 20_000 })
  })

  it('aborts pending startup during disposal without requesting a failing exit', async () => {
    const fixture = await larkFixture()
    cleanup.push(() => fixture.close())
    fixture.setReady(false)
    const h = await createDriverHarness(cleanup, { command: fixture.command })
    await h.ctx.plugin(SubprocessLocal)
    const exit = vi.fn()
    provideCmdline(h.ctx, { args: [], exit })
    apply(h.ctx, h.config)
    await fixture.connected()
    await h.ctx.fiber.dispose()
    expect(exit).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(fixture.consumers.size).toBe(0) }, { timeout: 20_000 })
  })
})
