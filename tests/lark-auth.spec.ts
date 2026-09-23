import { describe, expect, it } from 'vitest'
import { parseIdentity, parseProfiles, queryLark } from '../src/lark-auth.ts'

describe('public lark-cli discovery', () => {
  it('selects application names without retaining secrets or token status', () => {
    expect(parseProfiles([{ name: 'my-app', appId: 'cli_test', secret: 'discard' }])).toEqual([{ name: 'my-app', appId: 'cli_test' }])
    expect(parseProfiles([])).toEqual([])
    for (const value of [null, {}, '[]']) expect(() => parseProfiles(value)).toThrow('application list')
    for (const value of [null, [], {}, { name: ' ', appId: 'id' }, { name: 1 }, { name: 'ok', appId: false }]) {
      expect(() => parseProfiles([value])).toThrow('invalid application profile')
    }
  })

  it('accepts a verified bot with expired user OAuth but never implies human authorization', () => {
    expect(parseIdentity({ identities: {
      bot: { available: true, verified: true, appName: 'Test bot', secret: 'discard' },
      user: { status: 'missing', openId: 'ou_owner', userName: 'Owner' },
    } })).toEqual({ botReady: true, botName: 'Test bot', userId: 'ou_owner', userName: 'Owner' })
    for (const value of [null, [], {}, { identities: { bot: { available: true }, user: { openId: 'invalid' } } }]) {
      expect(parseIdentity(value)).toEqual({ botReady: false, botName: undefined, userId: undefined, userName: undefined })
    }
  })

  it('passes arguments literally and bounds external queries', async () => {
    const value = await queryLark([process.execPath, '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--'], ['$(whoami)', 'a b'])
    expect(value).toEqual(['$(whoami)', 'a b'])
    await expect(queryLark([process.execPath, '\0'], [])).rejects.toThrow('failed or timed out')
    await expect(queryLark([], [])).rejects.toThrow('executable')
    await expect(queryLark(['missing-feishu-command-12345'], [])).rejects.toThrow('failed or timed out')
    await expect(queryLark([process.execPath, '-e', 'setInterval(()=>{}, 1000)'], [], 100)).rejects.toThrow('failed or timed out')
    await expect(queryLark([process.execPath, '-e', 'console.log("not JSON")'], [])).rejects.toThrow('invalid JSON')
  })

  it('reports CLI error messages without forwarding unrelated error fields or raw stderr', async () => {
    const failure = async (stderr: string) => queryLark([process.execPath, '-e', 'process.stderr.write(process.argv[1]);process.exitCode=1', stderr], [])
    await expect(failure(JSON.stringify({ error: { message: 'Missing bot capability', token: 'SECRET' } }))).rejects.toThrow('lark-cli: Missing bot capability')
    await expect(failure('SECRET raw log')).rejects.toThrow('failed or timed out')
    await expect(failure(JSON.stringify({ error: { secret: 'SECRET' } }))).rejects.toThrow('failed or timed out')
  })
})
