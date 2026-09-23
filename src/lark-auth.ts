/** Public lark-cli discovery commands; no credential-store access. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)

/** A configured application that setup can select. */
export interface LarkProfile {
  name: string
  appId: string
}

/** Non-secret identity fields used for configuration and diagnostics. */
export interface LarkIdentity {
  botReady: boolean
  botName?: string
  userId?: string
  userName?: string
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** Validate application-list output from `profile list`. */
export function parseProfiles(value: unknown): LarkProfile[] {
  if (!Array.isArray(value)) throw new Error('lark-cli profile list did not return an application list. Update lark-cli and try again.')
  return value.map((item: unknown) => {
    const row = record(item)
    if (typeof row.name !== 'string' || row.name.trim() === '' || typeof row.appId !== 'string') {
      throw new Error('lark-cli returned an invalid application profile.')
    }
    return { name: row.name, appId: row.appId }
  })
}

/** Select only non-secret fields from `auth status --json --verify`. */
export function parseIdentity(value: unknown): LarkIdentity {
  const identities = record(record(value).identities)
  const bot = record(identities.bot)
  const user = record(identities.user)
  return {
    botReady: bot.available === true && bot.verified === true,
    botName: typeof bot.appName === 'string' ? bot.appName : undefined,
    userId: typeof user.openId === 'string' && /^ou_[A-Za-z0-9]+$/.test(user.openId) ? user.openId : undefined,
    userName: typeof user.userName === 'string' ? user.userName : undefined,
  }
}

/**
 * Run a bounded, read-only CLI query as argv, returning its JSON output.
 * @param command - executable and fixed arguments.
 * @param args - public lark-cli query arguments.
 * @param timeoutMs - process deadline.
 */
export async function queryLark(command: readonly string[], args: readonly string[], timeoutMs = 30_000): Promise<unknown> {
  const [file, ...prefix] = command
  if (file === undefined) throw new Error('Specify a lark-cli executable.')
  let stdout: string
  try {
    const result = await execute(file, [...prefix, ...args], {
      timeout: timeoutMs,
      maxBuffer: 1_048_576,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
    })
    stdout = result.stdout
  } catch (error: unknown) {
    // CLI error envelopes can contain credentials in unrelated fields; report only the documented message.
    const failure = record(error)
    let message = 'The command failed or timed out. Check that lark-cli is installed and the selected profile is configured.'
    if (typeof failure.stderr === 'string') {
      try {
        const decoded: unknown = JSON.parse(failure.stderr)
        const detail = record(record(decoded).error).message
        if (typeof detail === 'string') message = detail
      } catch (parseError: unknown) {
        // Non-JSON stderr is deliberately not forwarded; it may include the full environment or argv.
        void parseError
      }
    }
    throw new Error(`lark-cli: ${message}`)
  }
  try {
    const decoded: unknown = JSON.parse(stdout)
    return decoded
  } catch (error: unknown) {
    throw new Error('lark-cli returned invalid JSON. Update lark-cli and retry.', { cause: error })
  }
}
